import { Component } from 'react';

export class ErrorBoundary extends Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('App error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#020617] text-white flex flex-col items-center justify-center p-8 font-sans">
          <h1 className="text-2xl font-bold text-yellow-500 mb-4">Something went wrong</h1>
          <p className="text-gray-400 text-sm mb-6 max-w-md text-center">{this.state.error?.message || 'Unknown error'}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-yellow-500 text-black font-bold rounded-xl hover:bg-yellow-400 transition-colors"
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
