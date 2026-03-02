'use client'

import { motion, AnimatePresence } from "framer-motion"
import { Plus, LucideIcon } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

interface SocialIcon {
  Icon: LucideIcon
  href?: string
  onClick?: () => void
  className?: string
  active?: boolean
  circleBg?: string
  iconClassName?: string
}

interface AnimatedSocialIconsProps {
  icons: SocialIcon[]
  className?: string
  iconSize?: number
}

export function AnimatedSocialIcons({ 
  icons, 
  className,
  iconSize = 20
}: AnimatedSocialIconsProps) {
  const [active, setActive] = useState(false)

  const buttonSize = "size-10 sm:size-16" 

  return (
    <div className={cn("w-full relative flex items-center gap-4", className)}>
      <motion.button
        className={cn(
          buttonSize,
          "rounded-full flex items-center justify-center shrink-0",
          "bg-yellow-500 hover:bg-yellow-400 transition-colors"
        )}
        onClick={() => setActive(!active)}
        animate={{ rotate: active ? 45 : 0 }}
        transition={{ type: "ease-in", duration: 0.5 }}
      >
        <Plus 
          size={iconSize} 
          strokeWidth={3} 
          className="text-black" 
        />
      </motion.button>

      <AnimatePresence>
        {active && icons.map(({ Icon, href, onClick, className: iconClassName, active: isActive, circleBg, iconClassName: iconCls }, index) => (
          <motion.div
            key={index}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1, filter: "blur(0px)", rotate: 0 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "ease-in", duration: 0.3, delay: index * 0.05 }}
            className={cn(
              buttonSize,
              "rounded-full flex items-center justify-center shadow-lg hover:shadow-xl",
              "border border-white/10",
              circleBg || "bg-[#0a0a0c]/90 backdrop-blur-xl",
              isActive && "ring-2 ring-yellow-400 ring-offset-2 ring-offset-[#0a0a0c] shadow-[0_0_12px_rgba(234,179,8,0.4)]",
              iconClassName
            )}
          >
            {href ? (
              <a 
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center"
              >
                <Icon 
                  size={iconSize}
                  className={iconCls ?? "text-white/90 transition-all hover:text-white hover:scale-110 drop-shadow-sm"} 
                />
              </a>
            ) : onClick ? (
              <button
                type="button"
                onClick={onClick}
                className="flex items-center justify-center cursor-pointer border-0 bg-transparent p-0"
                aria-label="Theme or action"
              >
                <Icon 
                  size={iconSize}
                  className={iconCls ?? "text-white/90 transition-all hover:text-white hover:scale-110 drop-shadow-sm"} 
                />
              </button>
            ) : (
              <Icon 
                size={iconSize}
                className={iconCls ?? "text-white/90 transition-all hover:text-white hover:scale-110 drop-shadow-sm"} 
              />
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
