'use client';

import { useState } from 'react';

import { EmailVerification } from '@/components/auth/email-verification';
import { OnboardingStepper } from '@/components/onboarding/onboarding-stepper';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type CustomerOnboardingClientProps = {
  locale: Locale;
  dictionary: Dictionary;
};

export const CustomerOnboardingClient = ({
  locale: _locale,
  dictionary,
}: CustomerOnboardingClientProps) => {
  const d = dictionary.onboarding.customer;
  const steps = [d.steps.emailVerification];
  const [currentStep, setCurrentStep] = useState(0);

  const handleEmailVerified = () => {
    setCurrentStep(1);
  };

  if (currentStep >= steps.length) {
    return (
      <div className="onboarding-complete-shell">
        <div className="onboarding-complete-checkmark">✓</div>
        <h2 className="onboarding-complete-heading">{d.welcomeMessage}</h2>
        <a href="/" className="onboarding-complete-cta">
          {d.goToDashboard}
        </a>
      </div>
    );
  }

  return (
    <div className="onboarding-flow-shell">
      <OnboardingStepper
        steps={steps}
        currentStep={currentStep}
        stepLabel={dictionary.common.step}
        ofLabel={dictionary.common.of}
      />

      <div className="onboarding-step-content">
        {currentStep === 0 ? (
          <EmailVerification
            dictionary={dictionary.emailVerification}
            onVerified={handleEmailVerified}
          />
        ) : null}
      </div>
    </div>
  );
};
