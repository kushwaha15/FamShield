import forms from '@tailwindcss/forms';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: '#102A43',
          blue: '#1F5A85',
          teal: '#0F9D9A',
          mist: '#E8F4F4',
          canvas: '#F6F8FA',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '1rem',
      },
      boxShadow: {
        soft: '0 12px 40px rgba(16, 42, 67, 0.08)',
      },
    },
  },
  plugins: [forms],
};
