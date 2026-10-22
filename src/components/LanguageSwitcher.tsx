import React from 'react';
import { useLanguage } from '../locales';

export const LanguageSwitcher: React.FC = () => {
  const { language, setLanguage } = useLanguage();

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        height: '32px',
        boxSizing: 'border-box',
        background: '#0d0d14',
        border: '1px solid #272238',
        userSelect: 'none',
        fontFamily: 'var(--font-mono)',
      }}
      role="group"
      aria-label="Language selection"
    >
      <button
        type="button"
        onClick={() => setLanguage('id')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          padding: '0 0.75rem',
          height: '100%',
          fontSize: '0.78rem',
          fontWeight: 700,
          fontFamily: 'var(--font-mono)',
          border: 'none',
          cursor: 'pointer',
          background: language === 'id' ? '#ff00ff' : 'transparent',
          color: language === 'id' ? '#000000' : 'var(--text-secondary)',
          boxShadow: language === 'id' ? '0 0 10px rgba(255, 0, 255, 0.4)' : 'none',
          transition: 'all 0.15s ease',
        }}
        title="Bahasa Indonesia"
      >
        [ID]
      </button>

      <button
        type="button"
        onClick={() => setLanguage('en')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          padding: '0 0.75rem',
          height: '100%',
          fontSize: '0.78rem',
          fontWeight: 700,
          fontFamily: 'var(--font-mono)',
          border: 'none',
          cursor: 'pointer',
          background: language === 'en' ? '#ff00ff' : 'transparent',
          color: language === 'en' ? '#000000' : 'var(--text-secondary)',
          boxShadow: language === 'en' ? '0 0 10px rgba(255, 0, 255, 0.4)' : 'none',
          transition: 'all 0.15s ease',
        }}
        title="English"
      >
        [EN]
      </button>
    </div>
  );
};
