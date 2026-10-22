import React, { useState } from 'react';

interface HackerApiKeyInputProps {
  id?: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  showToggle?: boolean;
  revealLabel?: string;
  maskLabel?: string;
}

export const HackerApiKeyInput: React.FC<HackerApiKeyInputProps> = ({
  id,
  value,
  onChange,
  placeholder = 'ENTER API KEY...',
  disabled = false,
  error = false,
  showToggle = true,
  revealLabel = '[ REVEAL ]',
  maskLabel = '[ MASK ]',
}) => {
  const [isRevealed, setIsRevealed] = useState(false);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        position: 'relative',
        width: '100%',
        background: '#060608',
        border: error ? '1px solid #ff1e27' : '1px solid rgba(255, 0, 255, 0.35)',
        boxShadow: error
          ? '0 0 8px rgba(255, 30, 39, 0.35)'
          : '0 0 8px rgba(255, 0, 255, 0.15)',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      }}
      className="hacker-api-key-container"
    >
      {/* Terminal prefix badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 0.65rem',
          background: 'rgba(255, 0, 255, 0.08)',
          borderRight: '1px solid rgba(255, 0, 255, 0.25)',
          color: '#ff00ff',
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: '0.75rem',
          fontWeight: 700,
          letterSpacing: '0.05em',
          userSelect: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        KEY &gt;
      </div>

      {/* Input container with ASCII # masking */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          overflow: 'hidden',
        }}
      >
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          style={{
            width: '100%',
            height: '42px',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            padding: '0 0.75rem',
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: '0.85rem',
            letterSpacing: '0.08em',
            color: isRevealed ? '#ffffff' : 'transparent',
            caretColor: '#ff00ff',
            zIndex: 2,
          }}
        />

        {/* Masked ASCII overlay layer when not revealed and has value */}
        {!isRevealed && value && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              padding: '0 0.75rem',
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: '0.85rem',
              letterSpacing: '0.08em',
              color: '#ff00ff',
              textShadow: '0 0 6px rgba(255, 0, 255, 0.65)',
              pointerEvents: 'none',
              zIndex: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              userSelect: 'none',
            }}
          >
            {'#'.repeat(Math.max(16, Math.min(value.length, 38)))}
          </div>
        )}
      </div>

      {/* Action buttons: Clear & Reveal toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          padding: '0 0.35rem',
          background: 'rgba(255, 255, 255, 0.02)',
          borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        {value && !disabled && (
          <button
            type="button"
            onClick={() => onChange('')}
            title="Clear key"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.4)',
              cursor: 'pointer',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.7rem',
              padding: '0.3rem 0.45rem',
              transition: 'color 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#ff1e27')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.4)')}
          >
            [X]
          </button>
        )}

        {showToggle && (
          <button
            type="button"
            onClick={() => setIsRevealed(!isRevealed)}
            style={{
              background: isRevealed ? 'rgba(255, 0, 255, 0.15)' : 'transparent',
              border: '1px solid rgba(255, 0, 255, 0.3)',
              color: '#ff00ff',
              cursor: 'pointer',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.7rem',
              fontWeight: 700,
              letterSpacing: '0.05em',
              padding: '0.35rem 0.6rem',
              textTransform: 'uppercase',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#ff00ff';
              e.currentTarget.style.color = '#000000';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = isRevealed ? 'rgba(255, 0, 255, 0.15)' : 'transparent';
              e.currentTarget.style.color = '#ff00ff';
            }}
          >
            {isRevealed ? maskLabel : revealLabel}
          </button>
        )}
      </div>
    </div>
  );
};
export default HackerApiKeyInput;
