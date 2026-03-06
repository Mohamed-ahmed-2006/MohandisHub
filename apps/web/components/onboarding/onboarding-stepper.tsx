'use client';

type OnboardingStepperProps = {
  steps: string[];
  currentStep: number;
  stepLabel?: string;
  ofLabel?: string;
};

export function OnboardingStepper({
  steps,
  currentStep,
  stepLabel = 'Step',
  ofLabel = 'of',
}: OnboardingStepperProps) {
  const displayIndex = Math.min(Math.max(0, currentStep), steps.length - 1);
  const currentLabel = steps[displayIndex];

  return (
    <div className="onboarding-stepper" role="status" aria-live="polite">
      <span className="onboarding-stepper-text">
        {stepLabel} {displayIndex + 1} {ofLabel} {steps.length}
      </span>
      <span className="onboarding-stepper-current">{currentLabel}</span>
    </div>
  );
}
