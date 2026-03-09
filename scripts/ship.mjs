import { execSync } from 'child_process';
import process from 'process';

function run(command) {
  console.log(`\n> ${command}`);
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error) {
    console.error(`\n❌ Command failed: ${command}`);
    process.exit(1);
  }
}

console.log("🚀 Starting check, build, commit, and migrate process...");

// 1. Check for errors (Typecheck)
console.log("\n1️⃣  Checking for errors...");
run('npm run typecheck');

// 2. Build npm
console.log("\n2️⃣  Building the project...");
run('npm run build');

// 3. Git commit (not push)
console.log("\n3️⃣  Committing to Git...");
run('git add .');

try {
  const status = execSync('git status --porcelain', { stdio: 'pipe' }).toString();
  if (status.trim() === '') {
    console.log("No changes to commit.");
  } else {
    // You can modify this message to be dynamic if you prefer.
    run('git commit -m "chore: auto-check, build, and migrate"');
    console.log("✅ Changes committed.");
  }
} catch (err) {
  console.log("Failed to commit changes or no changes to commit.");
}

// 4. Migrate database
console.log("\n4️⃣  Pushing database migrations...");
// Uses npx to run the locally installed supabase CLI
run('npx supabase db push');

console.log("\n🎉 All done successfully!");
