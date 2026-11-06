import crypto from "crypto";

export interface CriterionItem {
  id: string;
  text: string;
  category: "FUNCTIONAL" | "SECURITY" | "PERFORMANCE" | "UX";
  mandatory: boolean;
}

export interface StructuredAgreement {
  versionNumber: number;
  criteria: CriterionItem[];
  criteriaHash: string;
}

/**
 * Computes canonical SHA-256 hash of criteria array.
 */
export function computeCriteriaHash(criteria: CriterionItem[]): string {
  const canonical = JSON.stringify(
    criteria.map((c) => ({
      id: c.id,
      text: c.text.trim(),
      category: c.category,
      mandatory: c.mandatory,
    }))
  );
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * Agreement Intelligence Engine: Converts natural-language scope into structured criteria.
 * Has intelligent parsing for common web/software workflows, with a robust fallback.
 */
export function generateCriteriaFromScope(
  title: string,
  description: string
): CriterionItem[] {
  const text = `${title} ${description}`.toLowerCase();
  const criteria: CriterionItem[] = [];
  let index = 1;

  const addCriterion = (
    criterionText: string,
    category: CriterionItem["category"] = "FUNCTIONAL",
    mandatory = true
  ) => {
    criteria.push({
      id: `crit-${index++}`,
      text: criterionText,
      category,
      mandatory,
    });
  };

  // E-commerce pattern
  if (text.includes("commerce") || text.includes("shop") || text.includes("store")) {
    addCriterion("Responsive homepage featuring hero section, navigation, and product showcases", "UX");
    addCriterion("Product catalogue displaying products with pricing, descriptions, and stock status", "FUNCTIONAL");
    addCriterion("Search and faceted filtering (by category, price, and attributes)", "FUNCTIONAL");
    addCriterion("Secure user authentication and customer profile management", "SECURITY");
    addCriterion("Interactive shopping cart with quantity adjustments and persistent state", "FUNCTIONAL");
    addCriterion("Payment gateway integration with webhook receipt handling and error states", "FUNCTIONAL");
    addCriterion("Admin dashboard for order management and inventory oversight", "FUNCTIONAL");
  }
  // Smart contract / DeFi pattern
  else if (text.includes("contract") || text.includes("token") || text.includes("defi") || text.includes("escrow")) {
    addCriterion("Smart contract implementation with OpenZeppelin security standards", "SECURITY");
    addCriterion("Access control enforcement and reentrancy protection on all fund-moving functions", "SECURITY");
    addCriterion("Unit test suite achieving >95% branch coverage with edge cases", "FUNCTIONAL");
    addCriterion("Deployment script and verified testnet contract address", "FUNCTIONAL");
    addCriterion("Web3 wallet integration allowing transaction signing and error recovery", "UX");
  }
  // API / Backend pattern
  else if (text.includes("api") || text.includes("backend") || text.includes("database")) {
    addCriterion("RESTful or GraphQL API endpoints matching specification with typed DTOs", "FUNCTIONAL");
    addCriterion("Relational database schema with migrations and foreign key constraints", "FUNCTIONAL");
    addCriterion("JWT or signature-based authentication with role-based authorization", "SECURITY");
    addCriterion("Automated integration test suite covering happy paths and error handling", "FUNCTIONAL");
    addCriterion("Rate limiting and input validation schemas preventing injection", "SECURITY");
  }
  // Mobile / Frontend / General pattern
  else {
    addCriterion(`Responsive interface fulfilling core user requirement: ${title.slice(0, 80)}`, "UX");
    addCriterion("Input validation and deterministic error boundaries on all interactive forms", "FUNCTIONAL");
    addCriterion("Authentication or wallet session state persistence across page refreshes", "SECURITY");
    addCriterion("Integration tests validating primary happy path flow end-to-end", "FUNCTIONAL");
    addCriterion("Clean modular code structure documented with setup and run instructions", "FUNCTIONAL");
  }

  return criteria;
}

export function createAgreementVersion(
  criteria: CriterionItem[],
  versionNumber = 1
): StructuredAgreement {
  return {
    versionNumber,
    criteria,
    criteriaHash: computeCriteriaHash(criteria),
  };
}

