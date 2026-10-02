import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Space Grotesk", "Inter Tight", "system-ui", "sans-serif"],
      },
      colors: {
        // Lead Factory Neo-Brutalism palette
        canvas: "#FFFDF5",
        "lf-black": "#000000",
        "lf-blue": "#3B82F6",
        "lf-green": "#58BC82",
        "lf-pink": "#FFC4EB",
        "lf-yellow": "#FDE047",
        "lf-gray": "#6B7280",
      },
      borderWidth: {
        "3": "3px",
      },
      boxShadow: {
        brutal: "8px 8px 0px 0px #000000",
        "brutal-sm": "4px 4px 0px 0px #000000",
        "brutal-xs": "2px 2px 0px 0px #000000",
        "brutal-blue": "8px 8px 0px 0px #3B82F6",
        "brutal-sm-blue": "4px 4px 0px 0px #3B82F6",
      },
      borderRadius: {
        DEFAULT: "0px",
        none: "0px",
        sm: "0px",
        md: "0px",
        lg: "0px",
        xl: "0px",
        "2xl": "0px",
        "3xl": "0px",
        full: "9999px",
      },
      animation: {
        "fade-in-up": "fadeInUp 0.4s ease-out forwards",
      },
      keyframes: {
        fadeInUp: {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
