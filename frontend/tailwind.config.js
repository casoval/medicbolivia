/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-outfit)', 'sans-serif'],
      },
      colors: {
        blue: {
          50:  '#E6F1FB',
          100: '#B5D4F4',
          400: '#378ADD',
          600: '#185FA5',
          700: '#0C447C',
          900: '#042C53',
        },
        teal: {
          50:  '#E1F5EE',
          500: '#1D9E75',
          700: '#0F6E56',
        },
      },
      animation: {
        'spin-slow':   'spin 1s linear infinite',
        'pulse-dot':   'pulse 1.5s ease-in-out infinite',
        'fade-up':     'fadeUp 0.3s ease forwards',
        'bounce-dot':  'bounce 1s infinite',
      },
      keyframes: {
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
