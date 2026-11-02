// Public PayPal button values. The secret stays in Vercel and is never written here.
const clientId = 'BAAsgAddqCu7dzo36yUWReE1DW2b_D27SfIIYZ033DMAONP7UxSqPMg2wF2QVeS85-Fjj4n4Mldi9lGGUs'
const planId = 'P-7VP86448GS1036156NLUJWRA'

export const paypalClientId = import.meta.env.VITE_PAYPAL_CLIENT_ID || clientId
export const paypalPlanId = import.meta.env.VITE_PAYPAL_PLAN_ID || planId
export const paypalOn = Boolean(paypalClientId && paypalPlanId)
