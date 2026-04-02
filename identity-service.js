
import { db, auth, doc, setDoc, getDoc } from "./firebase-config.js";

let identities = [];
let links = [];
let habits = [];
let goals = [];

export function addIdentity(name, color = 'blue') {
    const id = Math.random().toString(36).substring(2, 9);
    const newIdentity = { id, name, color, votes: 0 };
    identities.push(newIdentity);
    return newIdentity;
}

export function addLink(sourceId, targetId) {
    links.push({ sourceId, targetId });
}

export function addHabit({ identityId, name, frequency = 'daily', cue = '', reward = '', startHour = null, durationH = 0.5 }) {
    const id = Math.random().toString(36).substring(2, 9);
    const habit = { id, identityId, name, frequency, cue, reward, startHour, durationH, completions: {}, streak: 0 };
    habits.push(habit);
    return habit;
}

export function completeHabit(habitId, dateStr) {
    const habit = habits.find(h => h.id === habitId);
    if (!habit) return false;
    if (habit.completions[dateStr]) return false; // already done
    habit.completions[dateStr] = true;
    habit.streak = calculateStreak(habit);
    return true; // newly completed → cast a vote
}

export function uncompleteHabit(habitId, dateStr) {
    const habit = habits.find(h => h.id === habitId);
    if (!habit) return;
    delete habit.completions[dateStr];
    habit.streak = calculateStreak(habit);
}

export function isCompletedOnDate(habitId, dateStr) {
    const habit = habits.find(h => h.id === habitId);
    return habit ? !!habit.completions[dateStr] : false;
}

function calculateStreak(habit) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let streak = 0;
    for (let i = 0; i < 365; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        if (habit.completions[key]) {
            streak++;
        } else {
            break;
        }
    }
    return streak;
}

export function deleteHabit(habitId) {
    habits = habits.filter(h => h.id !== habitId);
}

export function deleteIdentity(identityId) {
    identities = identities.filter(i => i.id !== identityId);
    habits = habits.filter(h => h.identityId !== identityId);
    goals = goals.filter(g => g.identityId !== identityId);
}

export async function saveIdentityData() {
    // Always save to localStorage for guests
    localStorage.setItem('nexus_identity', JSON.stringify({ identities, links, habits, goals }));

    const user = auth.currentUser;
    if (!user) return;

    try {
        await setDoc(doc(db, "users", user.uid), { identities, links, habits, goals }, { merge: true });
    } catch (e) {
        console.error("Identity Save Error:", e);
    }
}

export async function loadIdentityData() {
    // Try localStorage first (works for guests too)
    const local = localStorage.getItem('nexus_identity');
    if (local) {
        try {
            const data = JSON.parse(local);
            identities = data.identities || [];
            links = data.links || [];
            habits = data.habits || [];
            goals = data.goals || [];
        } catch (e) { /* ignore */ }
    }

    const user = auth.currentUser;
    if (!user) return;

    try {
        const docSnap = await getDoc(doc(db, "users", user.uid));
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.identities) identities = data.identities;
            if (data.links) links = data.links;
            if (data.habits) habits = data.habits;
            if (data.goals) goals = data.goals;
        }
    } catch (e) {
        console.error("Identity Load Error:", e);
    }
}

export function getGoals() { return goals; }

export function addGoal({ identityId, title, description = '', targetDate = null }) {
    const id = Math.random().toString(36).substring(2, 9);
    const goal = { id, identityId, title, description, targetDate, completed: false, createdAt: new Date().toISOString() };
    goals.push(goal);
    return goal;
}

export function updateGoal(id, updates) {
    const goal = goals.find(g => g.id === id);
    if (!goal) return;
    Object.assign(goal, updates);
}

export function deleteGoal(id) {
    goals = goals.filter(g => g.id !== id);
}

export function getIdentities() { return identities; }
export function getLinks() { return links; }
export function getHabits() { return habits; }
export function setIdentities(data) { identities = data; }
export function setLinks(data) { links = data; }
export function setHabits(data) { habits = data; }
export function setGoals(data) { goals = data; }
