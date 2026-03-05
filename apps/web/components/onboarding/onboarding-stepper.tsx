type OnboardingStepperProps = {
  steps: string[];
  currentStep: number;
  stepLabel: string;
  ofLabel: string;
};

export const OnboardingStepper = ({
  steps,
  currentStep,
  stepLabel,
  ofLabel,
}: OnboardingStepperProps) => {
  return (
    <div className="onboarding-stepper">
      <div className="onboarding-stepper-header">
        <span className="onboarding-stepper-progress-text">
          {stepLabel} {currentStep + 1} {ofLabel} {steps.length}
        </span>
      </div>
      <div className="onboarding-stepper-track">
        {steps.map((label, index) => {
          const isComplete = index < currentStep;
          const isActive = index === currentStep;

          const className = [
            'onboarding-stepper-step',
            isComplete ? 'onboarding-stepper-step-complete' : '',
            isActive ? 'onboarding-stepper-step-active' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <div key={label} className={className}>
              <div className="onboarding-stepper-dot">
                {isComplete ? (
                  <span className="onboarding-stepper-check">&#10003;</span>
                ) : (
                  <span className="onboarding-stepper-number">{index + 1}</span>
                )}
              </div>
              <span className="onboarding-stepper-label">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
