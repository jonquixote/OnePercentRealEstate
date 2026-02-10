# Financial Metrics Engine

This project uses a unified calculation engine to ensure data consistency across the entire application.

## 🧮 Shared Library: `calculators.ts`

All financial math is centralized in `src/lib/calculators.ts`. This library is shared by:

- `PropertyCard.tsx` (Market Dashboard)
- `[id]/page.tsx` (Property Details)
- `CashflowCalculator.tsx` (Interactive Tool)

## 📏 Core Metrics

### 1% Rule

A property "passes" the 1% rule if the **Estimated Monthly Rent** is equal to or greater than **1% of the Purchase Price**.

- **Formula**: `(Rent / Price) >= 0.01`
- **Logic**: Used as a quick heuristic for initial deal screening.

### Monthly Cashflow

Calculated using a fully amortized mortgage formula (PI) plus all operating expenses.

- **Mortgage**: Standard 30-year fixed amortization.
- **Operating Expenses**:
  - Property Tax: 1.2% (default)
  - Insurance: $1,200/yr (default)
  - Maintenance: 5% of rent
  - Vacancy: 5% of rent
  - Management: 8% of rent
  - CapEx: 5% of rent
- **Formula**: `Rent - (Mortgage + PMI + Taxes + Insurance + OpEx)`

## 🔄 Rent Estimation Priority

The system prioritizes rent data in this order:

1. **Scraped Data**: Actual rental estimate from the listing source.
2. **Smart Estimate**: Calculated via `calculate_smart_rent` (HUD + Comps).
3. **National Average**: Fallback based on bedroom count if no other data exists.
