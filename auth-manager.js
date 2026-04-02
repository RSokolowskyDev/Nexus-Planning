
import { auth, db, provider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, doc, setDoc, getDoc } from "./firebase-config.js";

const loginBtn = document.getElementById('btn-login');
const userProfile = document.getElementById('user-profile');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const authLoading = document.getElementById('auth-loading');

let currentUser = null;

export function initAuth(onUserChange) {
    // Handle redirect result (for mobile/fallback)
    getRedirectResult(auth).catch(err => {
        if (err.code === 'auth/unauthorized-domain') {
            alert("Error: This domain is not authorized in Firebase Console. Please add 'rsokolowskydev.github.io' to Authorized Domains.");
        }
    });

    onAuthStateChanged(auth, async (user) => {
        authLoading.classList.add('hidden');
        if (user) {
            currentUser = user;
            loginBtn.style.display = 'none';
            userProfile.classList.remove('hidden');
            userAvatar.src = user.photoURL;
            userName.textContent = user.displayName.split(' ')[0]; // Just first name

            // Fetch cloud data if it exists
            const cloudData = await loadFromCloud(user.uid);
            onUserChange(user, cloudData);
        } else {
            currentUser = null;
            loginBtn.style.display = 'flex';
            userProfile.classList.add('hidden');
            onUserChange(null, null);
        }
    });

    loginBtn.addEventListener('click', () => {
        // Try popup, fallback to redirect if it fails (often due to blockers or domain issues)
        signInWithPopup(auth, provider).catch(err => {
            console.warn("Popup blocked or failed, trying redirect...", err);
            if (err.code === 'auth/unauthorized-domain') {
                alert("This domain is not authorized. Please add 'rsokolowskydev.github.io' to Authentication > Settings > Authorized domains in Firebase.");
            } else {
                signInWithRedirect(auth, provider);
            }
        });
    });

    userAvatar.addEventListener('click', () => {
        if (confirm("Sign out of NexusPlan?")) {
            signOut(auth);
        }
    });
}

export async function saveToCloud(data) {
    if (!currentUser) return;
    try {
        await setDoc(doc(db, "users", currentUser.uid), {
            plannerData: data,
            lastSaved: new Date().toISOString()
        }, { merge: true });
    } catch (e) {
        console.error("Cloud Save Error:", e);
    }
}

async function loadFromCloud(uid) {
    try {
        const docSnap = await getDoc(doc(db, "users", uid));
        if (docSnap.exists()) {
            return docSnap.data().plannerData;
        }
    } catch (e) {
        console.error("Cloud Load Error:", e);
    }
    return null;
}
