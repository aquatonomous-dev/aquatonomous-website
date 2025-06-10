/** @type {import('tailwindcss').Config} */
const defaultTheme = require("tailwindcss/defaultTheme");
module.exports = {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Signate Grotesk",
          "Bricolage Grotesque Variable",
          "Inter Variable",
          "Inter",
          ...defaultTheme.fontFamily.sans,
        ],
        mono: [
          "DM Mono",
          "monospace"
        ],
      },
      colors: {
        'AquaNavy':'#10292b',
        "AquaBlue":'#195c5a',
        'AquaNeon':'#98cfd4',
      },
      backgroundImage: {
        'radial-bottom-white': 'radial-gradient(circle at 50% 70%, var(--tw-gradient-stops))'
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
