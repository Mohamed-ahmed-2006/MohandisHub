export type Locale = 'en' | 'ar';

export type Dictionary = {
  common: {
    appName: string;
    continue: string;
    comingSoon: string;
    login: string;
    signUp: string;
    getStarted: string;
    backToHome: string;
  };
  theme: {
    switchToLight: string;
    switchToDark: string;
    darkLabel: string;
    lightLabel: string;
  };
  language: {
    switchLabel: string;
    current: string;
    target: string;
  };
  home: {
    headline: string;
    description: string;
    whatYouCanDoTitle: string;
    howItWorksTitle: string;
    stepLabel: string;
    footerText: string;
    features: Array<{
      title: string;
      description: string;
    }>;
    steps: string[];
  };
  login: {
    title: string;
    description: string;
  };
  onboarding: {
    role: {
      title: string;
      description: string;
      cards: {
        customer: {
          title: string;
          description: string;
        };
        expert: {
          title: string;
          description: string;
        };
        business: {
          title: string;
          description: string;
        };
      };
    };
    customer: {
      title: string;
      description: string;
    };
    expert: {
      title: string;
      description: string;
    };
    business: {
      title: string;
      description: string;
    };
  };
  auth: {
    common: {
      login: string;
      register: string;
      submit: string;
      loading: string;
      noAccount: string;
      haveAccount: string;
      switchToLogin: string;
      switchToRegister: string;
      sessionRestoring: string;
    };
    roles: {
      customer: string;
      expert: string;
      business: string;
    };
    login: {
      title: string;
      subtitle: string;
      emailLabel: string;
      passwordLabel: string;
    };
    register: {
      title: string;
      subtitle: string;
      displayNameLabel: string;
      emailLabel: string;
      passwordLabel: string;
      dateOfBirthLabel: string;
      phoneLabel: string;
      phoneHint: string;
    };
    validation: {
      required: string;
      invalidEmail: string;
      invalidPassword: string;
      invalidDisplayName: string;
      invalidDateOfBirth: string;
      minimumAge: string;
      invalidPhone: string;
    };
    errors: {
      generic: string;
    };
  };
};
