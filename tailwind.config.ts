import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#2563eb",
          600: "#1d4ed8",
          700: "#1e40af",
        },
        grey: {
          50: "#f9fafb",
          100: "#f3f4f6",
          200: "#e5e7eb",
          300: "#d1d5db",
          400: "#9ca3af",
          500: "#6b7280",
          600: "#4b5563",
          700: "#374151",
        },
        black: {
          50: "#f1f5f9",
          100: "#e2e8f0",
          500: "#0f172a",
          600: "#1e293b",
          700: "#334155",
        },
        red: {
          50: "#fef2f2",
          500: "#ef4444",
        },
        green: {
          50: "#f0fdf4",
          500: "#16a34a",
        },
        yellow: {
          50: "#fefce8",
          500: "#ca8a04",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        lis: {
          sidebar: "hsl(var(--lis-sidebar))",
          "sidebar-active": "hsl(var(--lis-sidebar-active))",
          "sidebar-fg": "hsl(var(--lis-sidebar-foreground))",
          "stat-blue": "hsl(var(--lis-stat-blue))",
          "stat-blue-icon": "hsl(var(--lis-stat-blue-icon))",
          "stat-amber": "hsl(var(--lis-stat-amber))",
          "stat-amber-icon": "hsl(var(--lis-stat-amber-icon))",
          "stat-green": "hsl(var(--lis-stat-green))",
          "stat-green-icon": "hsl(var(--lis-stat-green-icon))",
          "stat-red": "hsl(var(--lis-stat-red))",
          "stat-red-icon": "hsl(var(--lis-stat-red-icon))",
          "status-pending": "hsl(var(--lis-status-pending))",
          "status-progress": "hsl(var(--lis-status-progress))",
          "status-done": "hsl(var(--lis-status-done))",
          "column-sent": "hsl(var(--lis-column-sent))",
          "column-testing": "hsl(var(--lis-column-testing))",
          "column-done": "hsl(var(--lis-column-done))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        "flash-bg": {
          from: {
            backgroundColor: "rgb(186 230 253)", // sky-200
          },
          to: {
            backgroundColor: "transparent",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "flash-bg": "flash-bg 3s ease-out",
      },
    },
  },
  plugins: [
    tailwindcssAnimate,
    // touch: = จอสัมผัส (นิ้ว), mouse: = เมาส์/ทัชแพด — ใช้ปรับจุดกดโดยไม่กระทบ desktop
    plugin(({ addVariant }) => {
      addVariant("touch", "@media (pointer: coarse)");
      addVariant("mouse", "@media (pointer: fine)");
    }),
  ],
} satisfies Config;
