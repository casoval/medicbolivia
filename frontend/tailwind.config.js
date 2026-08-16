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
        'pop-in':      'popIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        // Anillo que se expande y se desvanece detrás de un punto de
        // estado "en vivo" (ej. bot de WhatsApp conectado). Más lento y
        // suave que el animate-ping por defecto de Tailwind (1s), para
        // que llame la atención sin sentirse frenético en un panel que
        // queda abierto un buen rato.
        'ping-slow':   'pingSlow 2s cubic-bezier(0, 0, 0.2, 1) infinite',
      },
      keyframes: {
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        popIn: {
          '0%':   { opacity: '0', transform: 'scale(0.5)' },
          '70%':  { opacity: '1', transform: 'scale(1.1)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        pingSlow: {
          '0%':   { transform: 'scale(1)', opacity: '0.75' },
          '75%, 100%': { transform: 'scale(2.4)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
}
