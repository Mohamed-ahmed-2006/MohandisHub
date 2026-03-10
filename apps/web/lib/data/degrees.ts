/**
 * Common degree/qualification types with English and Arabic labels.
 * Used for academic record form - options may be filtered by country in the future.
 */
export type DegreeEntry = {
  id: string;
  nameEn: string;
  nameAr: string;
};

export const DEGREES: DegreeEntry[] = [
  { id: 'bsc', nameEn: 'Bachelor of Science (BSc)', nameAr: 'بكالوريوس علوم (BSc)' },
  { id: 'ba', nameEn: 'Bachelor of Arts (BA)', nameAr: 'بكالوريوس آداب (BA)' },
  { id: 'beng', nameEn: 'Bachelor of Engineering (BEng)', nameAr: 'بكالوريوس هندسة (BEng)' },
  { id: 'bba', nameEn: 'Bachelor of Business Administration (BBA)', nameAr: 'بكالوريوس إدارة أعمال (BBA)' },
  { id: 'barch', nameEn: 'Bachelor of Architecture (BArch)', nameAr: 'بكالوريوس هندسة معمارية (BArch)' },
  { id: 'llb', nameEn: 'Bachelor of Laws (LLB)', nameAr: 'بكالوريوس قانون (LLB)' },
  { id: 'bpharm', nameEn: 'Bachelor of Pharmacy (BPharm)', nameAr: 'بكالوريوس صيدلة (BPharm)' },
  { id: 'bds', nameEn: 'Bachelor of Dental Surgery (BDS)', nameAr: 'بكالوريوس جراحة أسنان (BDS)' },
  { id: 'mbbs', nameEn: 'Bachelor of Medicine (MBBS/MD)', nameAr: 'بكالوريوس طب (MBBS/MD)' },
  { id: 'associate', nameEn: 'Associate Degree', nameAr: 'دبلوم جامعي (شهادة جامعية متوسطة)' },
  { id: 'msc', nameEn: 'Master of Science (MSc)', nameAr: 'ماجستير علوم (MSc)' },
  { id: 'ma', nameEn: 'Master of Arts (MA)', nameAr: 'ماجستير آداب (MA)' },
  { id: 'meng', nameEn: 'Master of Engineering (MEng)', nameAr: 'ماجستير هندسة (MEng)' },
  { id: 'mba', nameEn: 'Master of Business Administration (MBA)', nameAr: 'ماجستير إدارة أعمال (MBA)' },
  { id: 'march', nameEn: 'Master of Architecture (MArch)', nameAr: 'ماجستير هندسة معمارية (MArch)' },
  { id: 'llm', nameEn: 'Master of Laws (LLM)', nameAr: 'ماجستير قانون (LLM)' },
  { id: 'mpharm', nameEn: 'Master of Pharmacy (MPharm)', nameAr: 'ماجستير صيدلة (MPharm)' },
  { id: 'phd', nameEn: 'Doctor of Philosophy (PhD)', nameAr: 'دكتوراه (PhD)' },
  { id: 'edd', nameEn: 'Doctor of Education (EdD)', nameAr: 'دكتوراه في التربية (EdD)' },
  { id: 'md_research', nameEn: 'Doctor of Medicine (Research)', nameAr: 'دكتوراه طب (بحثي)' },
  { id: 'diploma', nameEn: 'Diploma', nameAr: 'دبلوم' },
  { id: 'diploma_tech', nameEn: 'Technical Diploma', nameAr: 'دبلوم فني' },
  { id: 'diploma_postgrad', nameEn: 'Postgraduate Diploma', nameAr: 'دبلوم دراسات عليا' },
  { id: 'certificate', nameEn: 'Professional Certificate', nameAr: 'شهادة مهنية' },
  { id: 'certificate_tech', nameEn: 'Technical Certificate', nameAr: 'شهادة فنية' },
  { id: 'license_prof', nameEn: 'Professional License', nameAr: 'رخصة مهنية' },
  { id: 'license_eng', nameEn: 'Engineering License (PE)', nameAr: 'رخصة مزاولة الهندسة (PE)' },
  { id: 'other', nameEn: 'Other', nameAr: 'أخرى' },
];

export const getDegreeById = (id: string): DegreeEntry | undefined =>
  DEGREES.find((d) => d.id === id);
