export type BoutiqueMapping = {
  key: string;
  shopifyLocationName: string;
  prestaCustomerId: number | null;
};

export const BOUTIQUE_MAPPINGS: BoutiqueMapping[] = [
  {
    key: "toulon",
    shopifyLocationName: "Boutique Toulon",
    prestaCustomerId: 21749,
  },
  {
    key: "chicago",
    shopifyLocationName: "Boutique Chicago",
    prestaCustomerId: null,
  },
];

export function getBoutiqueMappingByLocationName(locationName: string): BoutiqueMapping | null {
  const normalized = locationName.trim().toLowerCase();
  return (
    BOUTIQUE_MAPPINGS.find((mapping) => mapping.shopifyLocationName.trim().toLowerCase() === normalized) ?? null
  );
}

export function canSyncLocation(locationName: string): boolean {
  const mapping = getBoutiqueMappingByLocationName(locationName);
  return Boolean(mapping?.prestaCustomerId);
}

export function buildMissingPrestaConfigMessage(locationName: string): string {
  return `La boutique "${locationName}" n'est pas encore configurée pour Prestashop BtoB. Configurez l'identifiant client avant de synchroniser.`;
}

