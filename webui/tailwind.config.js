/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        obsidian: {
          950: '#07090E', // Deepest background canvas (Linear style)
          900: '#0C0F17', // Primary surface panel
          850: '#121622', // Raised card surface
          800: '#1A202C', // Border / separator
          700: '#262D3D', // Hover border
          600: '#3A4459', // Muted text/icons
        },
        cyber: {
          cyan: '#00F0FF',   // Primary electric signal
          glow: 'rgba(0, 240, 255, 0.15)',
          gold: '#F5C542',   // Resonator gold accent
          emerald: '#10B981',// Success status
          rose: '#F43F5E',   // Error status
          amber: '#F59E0B',  // Warning status
        }
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        'cyber-glow': '0 0 20px rgba(0, 240, 255, 0.15)',
        'gold-glow': '0 0 20px rgba(245, 197, 66, 0.15)',
        'panel': '0 4px 20px -2px rgba(0, 0, 0, 0.5)',
      },
      animation: {
        'pulse-glow': 'pulseGlow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.2s ease-out forwards',
        'slide-down': 'slideDown 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.4 },
        },
        fadeIn: {
          '0%': { opacity: 0, transform: 'scale(0.98)' },
          '100%': { opacity: 1, transform: 'scale(1)' },
        },
        slideDown: {
          '0%': { opacity: 0, transform: 'translateY(-8px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
