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
  nav: {
    home: string;
    profile: string;
    browse: string;
    bookings: string;
    projects: string;
    subscriptions: string;
    chat: string;
    admin: string;
    plan: string;
    upgradePlan: string;
    logout: string;
    settings: string;
    history: string;
    helpSupport: string;
    menuOpen: string;
    menuClose: string;
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
  admin: {
    title: string;
    pendingVerifications: string;
    identity: string;
    academic: string;
    business: string;
    noPending: string;
    loading: string;
    approve: string;
    reject: string;
    notes: string;
    viewProfile: string;
    user: string;
    email: string;
    role: string;
    backToApp: string;
    tabs: {
      dashboard: string;
      users: string;
      plans: string;
      transactions: string;
      services: string;
      categories: string;
      verifications: string;
    };
    dashboard: {
      totalUsers: string;
      activeUsers: string;
      totalRevenue: string;
      totalTransactions: string;
      pendingVerifications: string;
      activeServices: string;
      totalPlans: string;
      usersByRole: string;
    };
    users: {
      title: string;
      search: string;
      filterRole: string;
      allRoles: string;
      filterStatus: string;
      active: string;
      inactive: string;
      all: string;
      name: string;
      email: string;
      role: string;
      status: string;
      plan: string;
      joined: string;
      actions: string;
      activate: string;
      deactivate: string;
      delete: string;
      edit: string;
      view: string;
      confirmDelete: string;
      noUsers: string;
      userDetail: {
        title: string;
        basicInfo: string;
        wallet: string;
        actions: string;
        displayName: string;
        phone: string;
        nationality: string;
        dateOfBirth: string;
        emailVerified: string;
        yes: string;
        no: string;
        balance: string;
        currency: string;
        adjustBalance: string;
        changePlan: string;
        changeRole: string;
        adminFlag: string;
        changeAdmin: string;
        sendVerificationEmail: string;
        verifyEmail: string;
        lastLogin: string;
        createdAt: string;
      };
    };
    plansMgmt: {
      title: string;
      createPlan: string;
      editPlan: string;
      name: string;
      slug: string;
      price: string;
      billingCycle: string;
      features: string;
      active: string;
      actions: string;
      noPlans: string;
      confirmDelete: string;
      description: string;
      currency: string;
      durationDays: string;
      trialDays: string;
      maxServices: string;
      maxProjects: string;
      sortOrder: string;
    };
    txns: {
      title: string;
      filterType: string;
      filterStatus: string;
      allTypes: string;
      allStatuses: string;
      dateFrom: string;
      dateTo: string;
      user: string;
      type: string;
      amount: string;
      balanceAfter: string;
      status: string;
      description: string;
      date: string;
      actions: string;
      reverse: string;
      adjust: string;
      confirmReverse: string;
      noTransactions: string;
      adjustTitle: string;
      adjustUser: string;
      adjustType: string;
      adjustAmount: string;
      adjustDescription: string;
    };
    servicesMgmt: {
      title: string;
      filterStatus: string;
      allStatuses: string;
      provider: string;
      category: string;
      price: string;
      status: string;
      featured: string;
      actions: string;
      approve: string;
      reject: string;
      rejectReason: string;
      noServices: string;
    };
    categoriesMgmt: {
      title: string;
      create: string;
      edit: string;
      nameEn: string;
      nameAr: string;
      slug: string;
      icon: string;
      sortOrder: string;
      active: string;
      actions: string;
      noCategories: string;
      confirmDelete: string;
    };
  };
  wallet: {
    balance: string;
    deposit: string;
    depositTitle: string;
    crypto: string;
    creditCard: string;
    comingSoon: string;
    chooseMethod: string;
    depositAmountPlaceholder: string;
    depositAmountPlaceholderCard: string;
    depositPayWithCrypto: string;
    depositPayWithCard: string;
    depositRedirecting: string;
    depositError: string;
    depositMinAmount?: string;
    depositCardUnavailable?: string;
    depositSuccess?: string;
    depositCancelled?: string;
  };
  plan: {
    currentPlan: string;
    noPlans: string;
    choosePlan: string;
    activePlan: string;
    monthly: string;
    confirmTitle: string;
    confirmText: string;
    confirm: string;
    subscribeSuccess: string;
  };
  needs: {
    myNeeds: string;
    postNeed: string;
    titlePlaceholder: string;
    descPlaceholder: string;
    anyCategory: string;
    fixed: string;
    hourly: string;
    budgetPlaceholder: string;
    timelinePlaceholder: string;
    submitNeed: string;
    noNeeds: string;
    bidsCount: string;
    viewBids: string;
    awarded: string;
    bidsFor: string;
    noBids: string;
    award: string;
    availableNeeds: string;
    myBids: string;
    noOpenNeeds: string;
    postedBy: string;
    placeBid: string;
    bidAmountPlaceholder: string;
    bidMessagePlaceholder: string;
    bidDeliveryPlaceholder: string;
    submitBid: string;
  };
  homeSearch: {
    welcomeBack: string;
    serviceType: string;
    chooseServiceType: string;
    city: string;
    chooseCity: string;
    area: string;
    chooseArea: string;
    areaPlaceholder: string;
    providerType: string;
    expert: string;
    businessProvider: string;
    anyProvider: string;
    search: string;
    noResults: string;
    topExperts: string;
    topBusinesses: string;
    results: string;
    viewDetails: string;
  };
  profile: {
    title: string;
    accountTab: string;
    expertTab: string;
    businessTab: string;
    documentsTab: string;
    preferencesTab: string;
    backToApp: string;
    saveSuccess: string;
    saveError: string;
    loading: string;
    account: {
      sectionTitle: string;
      displayNameLabel: string;
      emailLabel: string;
      emailChangeButton: string;
      emailChangePending: string;
      emailChangeTitle: string;
      emailChangeDescription: string;
      newEmailLabel: string;
      newEmailPlaceholder: string;
      sendCodeButton: string;
      confirmCodeButton: string;
      cancelButton: string;
      codeLabel: string;
      codePlaceholder: string;
      emailChangeSuccess: string;
      emailChangeError: string;
      phoneLabel: string;
      phoneCodeLabel: string;
      nationalityLabel: string;
      dateOfBirthLabel: string;
    };
    documents: {
      identityTitle: string;
      identityDescription: string;
      academicTitle: string;
      academicDescription: string;
      noDocuments: string;
      status: string;
    };
  };
  auth: {
    common: {
      login: string;
      register: string;
      submit: string;
      loading: string;
      showPassword: string;
      hidePassword: string;
      noAccount: string;
      haveAccount: string;
      switchToLogin: string;
      switchToRegister: string;
      sessionRestoring: string;
    };
    roles: {
      admin: string;
      customer: string;
      expert: string;
      business: string;
    };
    login: {
      title: string;
      subtitle: string;
      emailLabel: string;
      passwordLabel: string;
      forgotPasswordLink: string;
    };
    forgotPassword: {
      title: string;
      subtitle: string;
      emailLabel: string;
      submitButton: string;
      successMessage: string;
      backToLogin: string;
    };
    resetPassword: {
      title: string;
      subtitle: string;
      passwordLabel: string;
      confirmPasswordLabel: string;
      submitButton: string;
      successMessage: string;
      invalidToken: string;
      passwordMismatch: string;
      backToLogin: string;
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
      phoneCodeLabel: string;
      nationalityLabel: string;
      nationalityPlaceholder: string;
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
