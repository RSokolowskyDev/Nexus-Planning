
import { db, auth, doc, setDoc, getDoc } from "./firebase-config.js";

let identities = [];
let links = [];

export function addIdentity(name, color = 'blue') {
    const id = Math.random().toString(36).substring(2, 9);
    const newIdentity = { id, name, color, votes: 0 };
    identities.push(newIdentity);
    return newIdentity;
}

export function addLink(sourceId, targetId) {
    links.push({ sourceId, targetId });
}

export async function saveIdentityData() {
    const user = auth.currentUser;
    if (!user) return;
    
    try {
        await setDoc(doc(db, "users", user.uid), {
            identities,
            links
        }, { merge: true });
    } catch (e) {
        console.error("Identity Save Error:", e);
    }
}

export async function loadIdentityData() {
    const user = auth.currentUser;
    if (!user) return;

    try {
        const docSnap = await getDoc(doc(db, "users", user.uid));
        if (docSnap.exists()) {
            identities = docSnap.data().identities || [];
            links = docSnap.data().links || [];
        }
    } catch (e) {
        console.error("Identity Load Error:", e);
    }
}

export function getIdentities() { return identities; }
export function getLinks() { return links; }
export function setIdentities(data) { identities = data; }
export function setLinks(data) { links = data; }
