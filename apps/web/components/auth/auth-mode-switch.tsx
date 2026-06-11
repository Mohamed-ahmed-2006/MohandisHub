type AuthMode = 'login' | 'register';

type AuthModeSwitchProps = {
  mode: AuthMode;
  loginLabel: string;
  registerLabel: string;
  onModeChange: (nextMode: AuthMode) => void;
  controlsPrefix?: string;
};

const modeOptions: AuthMode[] = ['login', 'register'];

export const AuthModeSwitch = ({
  mode,
  loginLabel,
  registerLabel,
  onModeChange,
  controlsPrefix,
}: AuthModeSwitchProps) => {
  return (
    <div className="auth-mode-switch" role="tablist" aria-label="Auth mode selection">
      {modeOptions.map((option) => {
        const className = [
          'auth-mode-switch-button',
          mode === option ? 'auth-mode-switch-button-active' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <button
            key={option}
            type="button"
            className={className}
            onClick={() => onModeChange(option)}
            role="tab"
            aria-selected={mode === option}
            {...(controlsPrefix ? { 'aria-controls': `${controlsPrefix}-${option}-panel` } : {})}
            suppressHydrationWarning
          >
            {option === 'login' ? loginLabel : registerLabel}
          </button>
        );
      })}
    </div>
  );
};

export type { AuthMode };
