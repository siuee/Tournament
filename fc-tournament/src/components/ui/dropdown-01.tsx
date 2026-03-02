import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Check } from "lucide-react";

export interface DropdownOption {
  id?: number | string;
  value: number | string;
  label: string;
  description?: string;
  [key: string]: unknown; // allow extra props (e.g. raw team object)
}

export interface AnimatedDropdownProps {
  options: DropdownOption[];
  value: DropdownOption | null;
  onChange: (option: DropdownOption) => void;
  placeholder?: string;
  isDisabled?: (option: DropdownOption) => boolean;
  isDark?: boolean;
  className?: string;
}

export const AnimatedDropdown = ({
  options,
  value,
  onChange,
  placeholder = "Select an option",
  isDisabled = () => false,
  isDark = true,
  className = "",
}: AnimatedDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (option: DropdownOption) => {
    if (isDisabled(option)) return;
    onChange(option);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <motion.button
        type="button"
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full px-6 py-4 rounded-xl border-2 transition-all duration-300 flex items-center justify-between ${
          isDark
            ? "bg-black border-white/30 text-white hover:border-yellow-500/50 focus:border-yellow-500"
            : "bg-white border-black/20 text-black hover:border-yellow-500/50"
        } outline-none`}
      >
        <span className="font-medium truncate">
          {value ? value.label : placeholder}
        </span>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.3 }}
        >
          <ChevronDown className="w-5 h-5 shrink-0" />
        </motion.div>
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className={`absolute w-full mt-2 rounded-xl border-2 overflow-hidden shadow-2xl z-50 ${
              isDark
                ? "bg-[#0a0a0c] border-yellow-500/30"
                : "bg-white border-black/20"
            }`}
          >
            {options.map((option, index) => {
              const disabled = isDisabled(option);
              return (
                <motion.button
                  key={option.value}
                  type="button"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.05 }}
                  onClick={() => handleSelect(option)}
                  disabled={disabled}
                  className={`w-full px-6 py-4 text-left transition-colors duration-200 flex items-center justify-between ${
                    isDark
                      ? "text-white hover:bg-yellow-500/10"
                      : "text-black hover:bg-yellow-100"
                  } ${disabled ? "opacity-40 cursor-not-allowed" : ""} ${
                    index !== options.length - 1
                      ? isDark
                        ? "border-b border-white/10"
                        : "border-b border-gray-200"
                      : ""
                  }`}
                >
                  <div>
                    <div className="font-medium truncate">{option.label}</div>
                    {option.description && (
                      <div
                        className={`text-sm ${
                          isDark ? "text-gray-400" : "text-gray-600"
                        }`}
                      >
                        {option.description}
                      </div>
                    )}
                  </div>
                  {value?.value === option.value && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      className="text-yellow-500 shrink-0"
                    >
                      <Check className="w-5 h-5" />
                    </motion.div>
                  )}
                </motion.button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
