/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f7ff",
          100: "#e0effe",
          200: "#bae0fd",
          300: "#7cc7fb",
          400: "#36aaf5",
          500: "#0c8de4",
          600: "#026fc3",
          700: "#03599e",
          800: "#074c82",
          900: "#0c406d",
          950: "#082949",
        },
        arc: {
          blue: "#0066FF",
          light: "#38B6FF",
        },
        hedera: {
          purple: "#7D52FF",
        },
        zerog: {
          cyan: "#00FFCC",
          emerald: "#10B981",
        },
      },
    },
  },
  plugins: [],
};

