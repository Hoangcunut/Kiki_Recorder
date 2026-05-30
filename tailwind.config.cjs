/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./index.html", "./src/renderer/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        panel: "#151821",
        muted: "#64748b",
        mint: "#2dd4bf",
        berry: "#f43f5e",
        amber: "#f59e0b"
      },
      boxShadow: {
        soft: "0 16px 50px rgba(15, 23, 42, 0.12)"
      }
    }
  },
  plugins: []
};
