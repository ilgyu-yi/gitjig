/** Finite syntax only; safe before account/runtime startup composition. */
export const applicationModelRoles = ['planner', 'challenger', 'adjudicator', 'implementer', 'reviewer', 'repairer', 'confirmer'] as const;
export type ApplicationModelRole = typeof applicationModelRoles[number];
