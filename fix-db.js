import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAGlTuOnaPDfsT1C8S8cbjhXkbzfM-wgrA",
  authDomain: "brewcontrol-app.firebaseapp.com",
  projectId: "brewcontrol-app",
  storageBucket: "brewcontrol-app.firebasestorage.app",
  messagingSenderId: "684520597229",
  appId: "1:684520597229:web:310a2aacecca3d54d7cee4",
  measurementId: "G-07ECP6SLP2"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, "controlcurso2");

async function fixDB() {
  console.log("Fetching expenses...");
  const expensesSnap = await getDocs(collection(db, 'expenses'));
  const expensesMap = {};
  
  expensesSnap.forEach(snap => {
    const data = snap.data();
    expensesMap[snap.id] = { fundId: data.fundId, title: data.title };
    console.log(`Expense: ${data.title} -> fundId: ${data.fundId}`);
  });

  console.log("Fetching funds...");
  const fundsSnap = await getDocs(collection(db, 'funds'));
  const fundsMap = {};
  fundsSnap.forEach(snap => {
      fundsMap[snap.id] = snap.data().name;
      console.log(`Fund: ${snap.id} -> ${snap.data().name}`);
  });

  console.log("\nFetching debts...");
  const debtsSnap = await getDocs(collection(db, 'debts'));
  let fixedCount = 0;
  
  for (const debtDoc of debtsSnap.docs) {
    const debt = debtDoc.data();
    const expenseInfo = expensesMap[debt.expenseId];
    
    if (expenseInfo) {
      const correctFundId = expenseInfo.fundId;
      
      if (debt.fundId !== correctFundId) {
        console.log(`Fixing debt ${debtDoc.id} (${debt.title}) from ${debt.fundId} to ${correctFundId}`);
        await updateDoc(doc(db, 'debts', debtDoc.id), { fundId: correctFundId });
        fixedCount++;
      }
    }
  }
  
  console.log(`\nFixed ${fixedCount} debts.`);
  process.exit(0);
}

fixDB().catch(err => {
    console.error(err);
    process.exit(1);
});
