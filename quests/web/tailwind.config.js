/** @type {import('tailwindcss').Config} */
const tokenColor = (token) => `oklch(var(${token}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-body)"],
        serif: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
      },
      zIndex: {
        20: "var(--z-raised)",
        30: "var(--z-sticky)",
        50: "var(--z-modal)",
      },
      transitionDuration: {
        DEFAULT: "var(--dur-base)",
        75: "var(--dur-fast)",
        100: "var(--dur-fast)",
        150: "var(--dur-base)",
        200: "var(--dur-base)",
        300: "var(--dur-slow)",
      },
      transitionTimingFunction: {
        DEFAULT: "var(--ease-out)",
        in: "var(--ease-in)",
        out: "var(--ease-out)",
        "in-out": "var(--ease-in-out)",
      },
      colors: {
        white: tokenColor("--color-ink-channels"),
        black: tokenColor("--color-ink-navy-channels"),
        bg: {
          0: tokenColor("--color-ink-navy-channels"),
          1: tokenColor("--color-paper-2-channels"),
          2: tokenColor("--color-paper-3-channels"),
          3: tokenColor("--color-paper-4-channels"),
        },
        accent: {
          signal: tokenColor("--sentinel-signal-channels"),
          gold: tokenColor("--sentinel-signal-channels"),
          teal: tokenColor("--sentinel-signal-channels"),
          ember: tokenColor("--color-error-channels"),
          violet: tokenColor("--sentinel-ink-2-channels"),
          amber: tokenColor("--color-warning-channels"),
          blue: tokenColor("--color-info-channels"),
          slate: tokenColor("--sentinel-ink-2-channels"),
          emerald: tokenColor("--color-success-channels"),
        },
        slate: {
          50: tokenColor("--color-neutral-50-channels"),
          100: tokenColor("--color-neutral-100-channels"),
          200: tokenColor("--color-neutral-200-channels"),
          300: tokenColor("--color-neutral-300-channels"),
          400: tokenColor("--color-neutral-400-channels"),
          500: tokenColor("--color-neutral-500-channels"),
          600: tokenColor("--color-neutral-600-channels"),
          700: tokenColor("--color-neutral-700-channels"),
          800: tokenColor("--color-neutral-800-channels"),
          900: tokenColor("--color-neutral-900-channels"),
          950: tokenColor("--color-neutral-950-channels"),
        },
        rose: {
          100: tokenColor("--color-error-100-channels"),
          200: tokenColor("--color-error-200-channels"),
          300: tokenColor("--color-error-300-channels"),
          400: tokenColor("--color-error-400-channels"),
          500: tokenColor("--color-error-500-channels"),
        },
        amber: {
          300: tokenColor("--color-warning-channels"),
        },
        emerald: {
          400: tokenColor("--color-success-channels"),
        },
        violet: {
          200: tokenColor("--color-violet-channels"),
          300: tokenColor("--color-violet-channels"),
          500: tokenColor("--color-violet-channels"),
        },
      },
    },
  },
  plugins: [],
};
