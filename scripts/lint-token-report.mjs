import { ESLint } from "eslint";
import path from "node:path";
import process from "node:process";

async function main() {
  console.log("Running MDS token pipeline analysis...");
  const eslint = new ESLint();

  // Lint the project, matching what next lint would typically cover
  const results = await eslint.lintFiles(["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"]);

  let mdsViolations = {
    "mds/no-raw-hex-class": 0,
    "mds/no-bare-outline-none": 0,
    "mds/no-hardcoded-shadow": 0,
    "no-restricted-syntax": 0,
    "no-restricted-properties": 0,
  };

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const result of results) {
    for (const msg of result.messages) {
      if (msg.ruleId && (msg.ruleId.startsWith("mds/") || msg.ruleId.startsWith("no-restricted-"))) {
        mdsViolations[msg.ruleId] = (mdsViolations[msg.ruleId] || 0) + 1;
      }
    }
    totalErrors += result.errorCount;
    totalWarnings += result.warningCount;
  }

  console.log("\n=========================================");
  console.log("      MDS Token Enforcement Report       ");
  console.log("=========================================\n");

  console.log("Governance Rules (Advisory / Burn Down):");
  console.log(`  mds/no-raw-hex-class         : ${mdsViolations["mds/no-raw-hex-class"].toString().padStart(3, ' ')} violations (Hex codes instead of theme tokens)`);
  console.log(`  mds/no-bare-outline-none     : ${mdsViolations["mds/no-bare-outline-none"].toString().padStart(3, ' ')} violations (Missing focus rings)`);
  console.log(`  mds/no-hardcoded-shadow      : ${mdsViolations["mds/no-hardcoded-shadow"].toString().padStart(3, ' ')} violations (Inline shadow instead of elevation token)`);
  console.log(`  no-restricted-properties     : ${mdsViolations["no-restricted-properties"].toString().padStart(3, ' ')} violations (Raw toFixed instead of <Num> component)`);
  
  console.log("\nStrict Enforcement (Errors block CI):");
  console.log(`  no-restricted-syntax         : ${mdsViolations["no-restricted-syntax"].toString().padStart(3, ' ')} errors (Redefining frozen components)`);

  const totalAdvisory = 
    mdsViolations["mds/no-raw-hex-class"] + 
    mdsViolations["mds/no-bare-outline-none"] + 
    mdsViolations["mds/no-hardcoded-shadow"] + 
    mdsViolations["no-restricted-properties"];
  
  console.log("\nSummary:");
  console.log(`  Total Advisory Violations    : ${totalAdvisory} (to be burned down)`);
  console.log(`  Total Project Errors         : ${totalErrors}`);
  console.log(`  Total Project Warnings       : ${totalWarnings}`);
  console.log("\n=========================================\n");

  if (totalErrors > 0) {
    console.error("❌ CI gate failed: ESLint found errors.");
    process.exit(1);
  } else {
    console.log("✅ CI gate passed: 0 ESLint errors.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
