
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAP_2pUtGvuYh6c1nICw4OLR9ZjnD-oKd0",
  authDomain: "nexus-users-38e9a.firebaseapp.com",
  projectId: "nexus-users-38e9a",
  storageBucket: "nexus-users-38e9a.firebasestorage.app",
  messagingSenderId: "827214807041",
  appId: "1:827214807041:web:b0e47c6f8bfb73660ec000",
  measurementId: "G-S62XY4LWWQ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

export { auth, db, provider, signInWithPopup, signOut, onAuthStateChanged, doc, setDoc, getDoc };
