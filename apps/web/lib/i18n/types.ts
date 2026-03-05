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
    submit: string;
    save: string;
    skip: string;
    next: string;
    back: string;
    upload: string;
    optional: string;
    step: string;
    of: string;
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
      welcomeMessage: string;
      goToDashboard: string;
      steps: {
        emailVerification: string;
      };
    };
    expert: {
      title: string;
      description: string;
      steps: {
        emailVerification: string;
        kyc: string;
        profileDetails: string;
        documents: string;
      };
      profileForm: {
        titleLabel: string;
        titlePlaceholder: string;
        headlineLabel: string;
        bioLabel: string;
        specializationsLabel: string;
        specializationsHint: string;
        yearsOfExperienceLabel: string;
        hourlyRateLabel: string;
        cityLabel: string;
        countryLabel: string;
        employerLabel: string;
        jobTitleLabel: string;
        linkedinLabel: string;
        portfolioLabel: string;
        languagesLabel: string;
        languagesHint: string;
        educationSummaryLabel: string;
      };
      documentsForm: {
        identityTitle: string;
        identityDescription: string;
        academicTitle: string;
        academicDescription: string;
        documentTypeLabel: string;
        fullNameOnDocLabel: string;
        documentNumberLabel: string;
        nationalityLabel: string;
        frontImageLabel: string;
        backImageLabel: string;
        selfieImageLabel: string;
        recordTypeLabel: string;
        titleLabel: string;
        institutionLabel: string;
        fieldOfStudyLabel: string;
        graduationYearLabel: string;
        gradeLabel: string;
        certificateImageLabel: string;
        transcriptImageLabel: string;
      };
      kycTitle: string;
      kycDescription: string;
      kycButton: string;
      kycPending: string;
      kycVerified: string;
      kycRejected: string;
    };
    business: {
      title: string;
      description: string;
      steps: {
        emailVerification: string;
        kyc: string;
        companyDetails: string;
        documents: string;
      };
      companyForm: {
        companyNameLabel: string;
        tradeLicenseLabel: string;
        taxIdLabel: string;
        commercialRegisterLabel: string;
        industryLabel: string;
        companySizeLabel: string;
        websiteLabel: string;
        companyEmailLabel: string;
        companyPhoneLabel: string;
        addressLabel: string;
        cityLabel: string;
        countryLabel: string;
        descriptionLabel: string;
        ownerNameLabel: string;
        ownerTitleLabel: string;
        ownerEmailLabel: string;
        ownerPhoneLabel: string;
        foundedYearLabel: string;
        employeesCountLabel: string;
      };
      documentsForm: {
        identityTitle: string;
        identityDescription: string;
        businessDocsTitle: string;
        businessDocsDescription: string;
        documentTypeLabel: string;
        fullNameOnDocLabel: string;
        documentNumberLabel: string;
        nationalityLabel: string;
        frontImageLabel: string;
        backImageLabel: string;
        selfieImageLabel: string;
        tradeLicenseImageLabel: string;
        commercialRegisterImageLabel: string;
        taxIdImageLabel: string;
      };
      kycTitle: string;
      kycDescription: string;
      kycButton: string;
      kycPending: string;
      kycVerified: string;
      kycRejected: string;
    };
  };
  emailVerification: {
    title: string;
    subtitle: string;
    codeSentTo: string;
    codeLabel: string;
    codePlaceholder: string;
    verifyButton: string;
    resendButton: string;
    resendCountdown: string;
    verified: string;
    verifiedMessage: string;
    continueButton: string;
    invalidCode: string;
    codeExpired: string;
    rateLimited: string;
    sendError: string;
    devCodeHint: string;
  };
  verification: {
    statusLabels: {
      unverified: string;
      pending: string;
      underReview: string;
      verified: string;
      rejected: string;
    };
    identityDocTypes: {
      nationalId: string;
      drivingLicense: string;
      passport: string;
    };
    academicRecordTypes: {
      degree: string;
      diploma: string;
      certificate: string;
      license: string;
    };
    companySizes: {
      '1-10': string;
      '11-50': string;
      '51-200': string;
      '201-500': string;
      '500+': string;
    };
  };
  appHome: {
    loading: string;
    roleLabel: string;
    profile: string;
    settings: string;
    logout: string;
    helpSupport: string;
    balanceTitle: string;
    balanceTopUp: string;
    balanceStubNote: string;
    welcome: string;
    genericRoleDescription: string;
    catalogFallbackNotice: string;
    categoryLabel: string;
    serviceLabel: string;
    chooseCategory: string;
    chooseService: string;
    noServicesForCategory: string;
    requestService: string;
    offerService: string;
    viewActivity: string;
    roleDescriptions: {
      customer: string;
      expert: string;
      business: string;
      admin: string;
    };
    suggestions: {
      customer: {
        title: string;
        items: string[];
        ctaLabel: string;
      };
      expert: {
        title: string;
        items: string[];
        ctaLabel: string;
      };
      business: {
        title: string;
        items: string[];
        ctaLabel: string;
      };
      admin: {
        title: string;
        items: string[];
        ctaLabel: string;
      };
      unknown: {
        title: string;
        items: string[];
      };
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
      chooseRoleTitle: string;
      chooseRoleSubtitle: string;
      stepChooseRole: string;
      stepAccountDetails: string;
      acceptTermsPrefix: string;
      acceptTermsConnector: string;
      privacyPolicy: string;
      termsAndConditions: string;
      // Per-role title & subtitle
      customerTitle: string;
      customerSubtitle: string;
      expertTitle: string;
      expertSubtitle: string;
      businessTitle: string;
      businessSubtitle: string;
      // Per-role displayName
      displayNameCustomerLabel: string;
      displayNameExpertLabel: string;
      displayNameBusinessLabel: string;
      displayNameBusinessHint: string;
      // Per-role DOB
      dateOfBirthBusinessLabel: string;
      dateOfBirthExpertHint: string;
      // Company name (business only)
      companyNameLabel: string;
      companyNamePlaceholder: string;
      // Per-role phone
      phoneBusinessLabel: string;
      phoneBusinessHint: string;
    };
    validation: {
      required: string;
      invalidEmail: string;
      invalidPassword: string;
      invalidDisplayName: string;
      invalidDateOfBirth: string;
      minimumAge: string;
      invalidPhone: string;
      phoneRequired: string;
      invalidCompanyName: string;
      acceptTermsRequired: string;
    };
    errors: {
      generic: string;
      networkError: string;
    };
  };
};
