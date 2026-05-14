export interface LongitudinalVisit {
  visitId: string;        // "v1", "v2", etc.
  timestamp: string;      // ISO
  data: Record<string, unknown>;
}

export interface LongitudinalSubmission {
  id: string;             // "longsub_{formId}_{subjectKey}"
  type: 'longitudinal';
  formId: string;
  subjectKey: string;
  fixedData: Record<string, unknown>;
  visits: LongitudinalVisit[];
  patientId?: string;
  createdAt: string;
  updatedAt: string;
  ownerId?: string;
}
