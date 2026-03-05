import type { Dictionary } from '../types';

export const enDictionary: Dictionary = {
  common: {
    appName: 'MohandisHub',
    continue: 'Continue',
    comingSoon: 'Coming soon.',
    login: 'Log in',
    signUp: 'Sign up',
    getStarted: 'Get started',
    backToHome: 'Back to home',
  },
  theme: {
    switchToLight: 'Switch to light mode',
    switchToDark: 'Switch to dark mode',
    darkLabel: 'Dark',
    lightLabel: 'Light',
  },
  language: {
    switchLabel: 'Switch language',
    current: 'EN',
    target: '\u0639',
  },
  home: {
    headline:
      'Egypt-first engineering services marketplace for customers, experts, and businesses.',
    description:
      'MohandisHub connects people who need engineering support with trusted professionals and structured service providers, with realtime chat and wallet-ledger workflows built into the foundation.',
    whatYouCanDoTitle: 'What you can do',
    howItWorksTitle: 'How it works',
    stepLabel: 'Step',
    footerText: 'MohandisHub foundation build. Local development mode.',
    features: [
      {
        title: 'Find expert help quickly',
        description:
          'Discover engineers and technical specialists for practical support and advice.',
      },
      {
        title: 'Request services with clarity',
        description: 'Describe your engineering need and connect with the right provider.',
      },
      {
        title: 'Real-time chat foundation',
        description: 'Built for direct in-app communication between customers and providers.',
      },
      {
        title: 'Wallet-ready payments',
        description: 'Architecture prepared for secure wallet ledger flows and commission logic.',
      },
    ],
    steps: [
      'Choose your role as Customer, Expert, or Business.',
      'Create a request or publish your engineering offer.',
      'Chat, agree on scope, and complete the service confidently.',
    ],
  },
  login: {
    title: 'Log in',
    description: 'Authentication flow is coming soon.',
  },
  onboarding: {
    role: {
      title: 'Choose your role',
      description:
        'Select how you want to use MohandisHub. You can expand profile capabilities later.',
      cards: {
        customer: {
          title: 'Customer',
          description: 'Request engineering help, consultations, fixes, and site visits.',
        },
        expert: {
          title: 'Expert',
          description: 'Offer professional engineering services and paid consultations.',
        },
        business: {
          title: 'Business',
          description: 'Provide structured engineering services with a company profile.',
        },
      },
    },
    customer: {
      title: 'Customer onboarding',
      description: 'Coming soon.',
    },
    expert: {
      title: 'Expert onboarding',
      description: 'Coming soon.',
    },
    business: {
      title: 'Business onboarding',
      description: 'Coming soon.',
    },
  },
  auth: {
    common: {
      login: 'Log in',
      register: 'Create account',
      submit: 'Continue',
      loading: 'Please wait...',
      noAccount: "Don't have an account?",
      haveAccount: 'Already have an account?',
      switchToLogin: 'Log in',
      switchToRegister: 'Sign up',
      sessionRestoring: 'Restoring session...',
    },
    roles: {
      customer: 'Customer',
      expert: 'Expert',
      business: 'Business',
    },
    login: {
      title: 'Log in to MohandisHub',
      subtitle: 'Use your account credentials to continue.',
      emailLabel: 'Email address',
      passwordLabel: 'Password',
    },
    register: {
      title: 'Create your account',
      subtitle: 'Start as customer, expert, or business and complete your profile next.',
      displayNameLabel: 'Display name',
      emailLabel: 'Email address',
      passwordLabel: 'Password',
      dateOfBirthLabel: 'Date of birth',
      phoneLabel: 'Phone (optional)',
      phoneHint: 'Optional now. You can update it later.',
    },
    validation: {
      required: 'This field is required.',
      invalidEmail: 'Please enter a valid email address.',
      invalidPassword:
        'Password must be 8-128 chars and include uppercase, lowercase, and a number.',
      invalidDisplayName: 'Display name must be between 2 and 100 characters.',
      invalidDateOfBirth: 'Date of birth must be in YYYY-MM-DD format.',
      minimumAge: 'You must be at least 20 years old.',
      invalidPhone: 'Phone number must be 20 characters or less.',
    },
    errors: {
      generic: 'Please review the form and try again.',
    },
  },
};
