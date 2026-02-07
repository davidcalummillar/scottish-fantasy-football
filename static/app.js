// === Scottish Fantasy Football App ===

// PASTE YOUR GOOGLE APPS SCRIPT DEPLOYMENT URL BELOW (between the quotes)
const API_BASE = 'https://script.google.com/macros/s/AKfycbziM7-226suVfEMg15x8cWfDCvOF-C5ODx-OfJI0KWa6jiVAMKWvlIX4bNMBU8WQ-Dzzw/exec';
const MAX_PER_CLUB = 3;
const MAX_SQUAD_SIZE = 15; // 11 starters + 4 bench
const MAX_BENCH = 4;

// === State ===
let state = {
    clubs: [],
    managers: [],
    players: [],
    davidSquad: [],
    ellSquad: [],
    settings: {},
    loading: true
};

let isSaving = false; // Prevent double-clicks

// === Formation Configurations ===
// Each formation defines rows displayed on the pitch (top to bottom for Ell, reversed for David)
// Types: DEF = defender only, MID = midfielder only, FWD = forward only,
//        MFDF = midfielder/defender flex, FWMF = forward/midfielder flex
const FORMATIONS = {
    '4-3-3':   { rows: [ {type:'DEF', count:4}, {type:'MID', count:3}, {type:'FWD', count:3} ] },
    '4-4-2':   { rows: [ {type:'DEF', count:4}, {type:'MID', count:4}, {type:'FWD', count:2} ] },
    '4-2-3-1': { rows: [ {type:'DEF', count:4}, {type:'MFDF', count:2}, {type:'FWMF', count:3}, {type:'FWD', count:1} ] },
    '3-5-2':   { rows: [ {type:'DEF', count:3}, {type:'MID', count:5}, {type:'FWD', count:2} ] },
    '3-4-3':   { rows: [ {type:'DEF', count:3}, {type:'MID', count:4}, {type:'FWD', count:3} ] },
    '4-1-4-1': { rows: [ {type:'DEF', count:4}, {type:'MFDF', count:1}, {type:'FWMF', count:4}, {type:'FWD', count:1} ] },
    '4-5-1':   { rows: [ {type:'DEF', count:4}, {type:'MID', count:5}, {type:'FWD', count:1} ] },
    '4-2-2-2': { rows: [ {type:'DEF', count:4}, {type:'MFDF', count:2}, {type:'FWMF', count:2}, {type:'FWD', count:2} ] },
    '4-3-2-1': { rows: [ {type:'DEF', count:4}, {type:'MFDF', count:3}, {type:'FWMF', count:2}, {type:'FWD', count:1} ] },
    '4-1-2-3': { rows: [ {type:'DEF', count:4}, {type:'MFDF', count:1}, {type:'FWMF', count:2}, {type:'FWD', count:3} ] },
    '3-4-1-2': { rows: [ {type:'DEF', count:3}, {type:'MFDF', count:4}, {type:'FWMF', count:1}, {type:'FWD', count:2} ] },
    '3-2-4-1': { rows: [ {type:'DEF', count:3}, {type:'MFDF', count:2}, {type:'FWMF', count:4}, {type:'FWD', count:1} ] },
    '3-4-2-1': { rows: [ {type:'DEF', count:3}, {type:'MFDF', count:4}, {type:'FWMF', count:2}, {type:'FWD', count:1} ] },
    '5-3-2':   { rows: [ {type:'DEF', count:5}, {type:'MID', count:3}, {type:'FWD', count:2} ] },
    '5-4-1':   { rows: [ {type:'DEF', count:5}, {type:'MID', count:4}, {type:'FWD', count:1} ] },
    '5-2-3':   { rows: [ {type:'DEF', count:5}, {type:'MID', count:2}, {type:'FWD', count:3} ] },
};

// Slot position rules: what positions can fill each slot type
const SLOT_ACCEPTS = {
    'GK':    ['GK'],
    'DEF':   ['DEF'],
    'MID':   ['MID'],
    'MFDF':  ['MID', 'DEF'],
    'FWMF':  ['FWD', 'MID'],
    'FWD':   ['FWD'],
    'BENCH': ['GK', 'DEF', 'MID', 'FWD']
};

// === Scoring Elements ===
// Position-specific scoring: GK has different elements than outfield players
const SCORING_OUTFIELD = [
    { key: 'goal',       label: 'Goal',         icon: '⚽',  points: 5 },
    { key: 'assist',     label: 'Assist',        icon: '👟',  points: 3 },
    { key: 'cleanSheet', label: 'Clean Sheet',   icon: '📄',  points: 4 },
    { key: 'penMiss',    label: 'Pen Miss',      icon: '❌',  points: -3 },
    { key: 'ownGoal',    label: 'Own Goal',      icon: '🔴', points: -3 },
    { key: 'yellow',     label: 'Yellow Card',   icon: '🟨', points: -1 },
    { key: 'red',        label: 'Red Card',      icon: '🟥', points: -3 },
];

const SCORING_GK = [
    { key: 'goal',       label: 'Goal',            icon: '⚽',  points: 10 },
    { key: 'assist',     label: 'Assist',           icon: '👟',  points: 3 },
    { key: 'cleanSheet', label: 'Clean Sheet',      icon: '📄',  points: 4 },
    { key: 'save',       label: 'Save',             icon: '🧤',  points: 1 },
    { key: 'goalConc',   label: 'Goal Conceded',    icon: '😞',  points: -1 },
    { key: 'penSave',    label: 'Pen Save',         icon: '🥅',  points: 3 },
    { key: 'penMiss',    label: 'Pen Miss',         icon: '❌',  points: -3 },
    { key: 'yellow',     label: 'Yellow Card',      icon: '🟨', points: -1 },
    { key: 'red',        label: 'Red Card',         icon: '🟥', points: -3 },
];

function getScoringElements(position) {
    return position === 'GK' ? SCORING_GK : SCORING_OUTFIELD;
}

function calculateScoreFromElements(counts, elements) {
    let total = 0;
    for (const el of elements) {
        total += (counts[el.key] || 0) * el.points;
    }
    return total;
}

// === Shirt SVG Template ===
function createShirtSVG(primaryColor, secondaryColor) {
    const pId = primaryColor.replace('#','');
    const sId = secondaryColor.replace('#','');
    return `
        <svg viewBox="0 0 100 110" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="sg_${pId}_${sId}" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:${primaryColor};stop-opacity:1" />
                    <stop offset="100%" style="stop-color:${primaryColor};stop-opacity:0.82" />
                </linearGradient>
            </defs>
            <path d="M22 28 Q5 38 8 58 Q10 62 18 55 L25 45 Z" fill="${secondaryColor}"/>
            <path d="M78 28 Q95 38 92 58 Q90 62 82 55 L75 45 Z" fill="${secondaryColor}"/>
            <path d="M25 28 Q25 25 28 22 L38 18 Q45 14 50 14 Q55 14 62 18 L72 22 Q75 25 75 28
                     L75 45 L75 100 Q75 105 70 105 L30 105 Q25 105 25 100 L25 45 Z"
                  fill="url(#sg_${pId}_${sId})"/>
            <path d="M38 18 Q44 22 50 22 Q56 22 62 18" fill="none" stroke="${secondaryColor}" stroke-width="3" stroke-linecap="round"/>
            <path d="M44 22 L50 32 L56 22" fill="none" stroke="${secondaryColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M30 30 Q32 50 30 90" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="4" stroke-linecap="round"/>
        </svg>
    `;
}

// === Utility Functions ===
function formatPlayerName(fullName) {
    if (!fullName) return '';
    const parts = fullName.split(' ');
    if (parts.length === 1) return fullName;
    return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

function formatCurrency(value) {
    const v = parseFloat(value);
    return isNaN(v) ? '£0m' : `£${v.toFixed(1)}m`;
}

function showToast(message, duration = 2500) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}

function getClubCount(squad, club) {
    return squad.filter(p => p.Club === club).length;
}

// === API Functions ===
async function fetchData(action, params) {
    const url = new URL(API_BASE);
    url.searchParams.set('action', action);
    if (params) {
        for (const [key, val] of Object.entries(params)) {
            url.searchParams.set(key, val);
        }
    }
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function postData(action, data) {
    const response = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action, payload: data })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function loadAllData() {
    const [clubs, managers, players, davidSquad, ellSquad, settings] = await Promise.all([
        fetchData('getClubs'),
        fetchData('getManagers'),
        fetchData('getPlayers'),
        fetchData('getSquad', { player: 'David' }),
        fetchData('getSquad', { player: 'Ell' }),
        fetchData('getSettings')
    ]);
    state = { clubs, managers, players, davidSquad, ellSquad, settings, loading: false };
}

// === Formation Slot Generation ===
function generateSlotsForFormation(formation) {
    const config = FORMATIONS[formation] || FORMATIONS['4-4-2'];
    const slots = [];
    slots.push({ type: 'GK', num: 1, row: 0 });
    let rowIdx = 1;
    for (const rowDef of config.rows) {
        for (let i = 1; i <= rowDef.count; i++) {
            slots.push({ type: rowDef.type, num: i, row: rowIdx });
        }
        rowIdx++;
    }
    return slots;
}

// === Smart Formation Change: Remap players to new slots ===
function remapPlayersForFormation(squad, oldFormation, newFormation) {
    const newSlots = generateSlotsForFormation(newFormation);
    const gkPlayer = squad.find(p => p.Position === 'GK' && p.Starting === 'TRUE');
    const nonGkStarters = squad.filter(p => p.Starting === 'TRUE' && p.Position !== 'GK');
    const benchPlayers = squad.filter(p => p.Starting === 'FALSE');

    // Build available field slots (excluding GK which is handled separately)
    const fieldSlots = newSlots.filter(s => s.type !== 'GK');

    const slotAssignments = {}; // slotKey -> player
    const placed = new Set();

    // Step 1: Place GK
    if (gkPlayer) {
        slotAssignments['GK1'] = { ...gkPlayer, Slot: 'GK1', Starting: 'TRUE' };
        placed.add(gkPlayer.Name);
    }

    // Step 2: Exact-match pass — place starters into strict position slots (DEF, MID, FWD)
    for (const slotType of ['DEF', 'MID', 'FWD']) {
        const slotsOfType = fieldSlots.filter(s => s.type === slotType);
        for (const slot of slotsOfType) {
            const slotKey = `${slot.type}${slot.num}`;
            if (slotAssignments[slotKey]) continue;
            const player = nonGkStarters.find(p => !placed.has(p.Name) && p.Position === slotType);
            if (player) {
                slotAssignments[slotKey] = { ...player, Slot: slotKey, Starting: 'TRUE' };
                placed.add(player.Name);
            }
        }
    }

    // Step 3: Flex-match pass — place remaining starters into flex slots (MFDF, FWMF)
    for (const slotType of ['MFDF', 'FWMF']) {
        const slotsOfType = fieldSlots.filter(s => s.type === slotType);
        const accepts = SLOT_ACCEPTS[slotType];
        for (const slot of slotsOfType) {
            const slotKey = `${slot.type}${slot.num}`;
            if (slotAssignments[slotKey]) continue;
            const player = nonGkStarters.find(p => !placed.has(p.Name) && accepts.includes(p.Position));
            if (player) {
                slotAssignments[slotKey] = { ...player, Slot: slotKey, Starting: 'TRUE' };
                placed.add(player.Name);
            }
        }
    }

    // Step 4: Collect unplaced starters — these overflow to bench
    const unplacedStarters = nonGkStarters.filter(p => !placed.has(p.Name));
    const allBenchPlayers = [...benchPlayers, ...unplacedStarters];

    // Step 5: If bench is over capacity, try to promote bench players into empty field slots
    const emptyFieldSlots = fieldSlots.filter(s => !slotAssignments[`${s.type}${s.num}`]);
    const promoted = new Set();
    for (const slot of emptyFieldSlots) {
        const slotKey = `${slot.type}${slot.num}`;
        const accepts = SLOT_ACCEPTS[slot.type];
        const bp = allBenchPlayers.find(p => !promoted.has(p.Name) && accepts.includes(p.Position));
        if (bp) {
            slotAssignments[slotKey] = { ...bp, Slot: slotKey, Starting: 'TRUE' };
            promoted.add(bp.Name);
        }
    }

    // Step 6: Build final result — keep ALL players (never delete anyone)
    const result = Object.values(slotAssignments);
    const finalBench = allBenchPlayers.filter(bp => !promoted.has(bp.Name));
    for (let i = 0; i < finalBench.length; i++) {
        result.push({ ...finalBench[i], Slot: `BENCH${i + 1}`, Starting: 'FALSE' });
    }

    return result;
}

// === Rendering ===
function renderManagerCard(playerName) {
    const id = playerName === 'David' ? 'david-manager' : 'ell-manager';
    const card = document.getElementById(id);
    const mgrName = state.settings[`${playerName}Manager`];
    const mgr = state.managers.find(m => m.Name === mgrName);

    if (mgr) {
        card.querySelector('.manager-avatar').style.background = mgr.PrimaryHex;
        card.querySelector('.manager-name').textContent = mgr.Name;
        card.querySelector('.manager-formation').textContent = mgr.Formation;
    } else {
        card.querySelector('.manager-avatar').style.background = '#333';
        card.querySelector('.manager-name').textContent = 'Select Manager';
        card.querySelector('.manager-formation').textContent = '-';
    }
}

function renderBudget(playerName) {
    const el = document.getElementById(playerName === 'David' ? 'david-budget' : 'ell-budget');
    const remaining = parseFloat(state.settings[`${playerName}Remaining`]) || 0;
    el.textContent = formatCurrency(remaining);
    el.classList.toggle('negative', remaining < 0);
}

function getFormationForPlayer(playerName) {
    const mgrName = state.settings[`${playerName}Manager`];
    const mgr = state.managers.find(m => m.Name === mgrName);
    return mgr?.Formation || '4-4-2';
}

// Get display score for a player (captain gets multiplier shown)
function getDisplayScore(squadPlayer, squad, playerName) {
    const playerScore = String(squadPlayer?.Score ?? '');
    if (!squadPlayer || playerScore === '') return null;
    if (playerScore === 'X') return 'X';

    const rawScore = parseFloat(playerScore) || 0;
    const captain = squad.find(p => p.Captain === 'TRUE');
    const viceCaptain = squad.find(p => p.ViceCaptain === 'TRUE');

    const captainScore = captain ? String(captain.Score ?? '') : '';
    const captainPlayed = captain && captainScore !== 'X';
    const tcActive = getChipState(playerName, 'TC') === 'active';

    // Captain (or VC promoted to captain) gets 2x (or 3x with TC)
    const captainMultiplier = tcActive ? 3 : 2;

    if (captainPlayed) {
        // Captain played: captain gets 2x/3x, VC gets 1.5x
        if (captain && squadPlayer.Name === captain.Name) {
            return rawScore * captainMultiplier;
        }
        if (viceCaptain && squadPlayer.Name === viceCaptain.Name) {
            return rawScore * 1.5;
        }
    } else {
        // Captain didn't play: VC becomes effective captain at 2x/3x
        if (viceCaptain && squadPlayer.Name === viceCaptain.Name) {
            return rawScore * captainMultiplier;
        }
    }
    return rawScore;
}

function renderPlayerSlot(slotInfo, squadPlayer, playerName, squad) {
    const slot = document.createElement('div');
    slot.className = 'player-slot';
    slot.dataset.slot = `${slotInfo.type}${slotInfo.num}`;
    slot.dataset.player = playerName;

    if (squadPlayer && squadPlayer.Name) {
        const isDNP = squadPlayer.Score === 'X';
        slot.classList.add('filled');
        if (isDNP) slot.classList.add('dnp');

        const displayScore = getDisplayScore(squadPlayer, squad, playerName);
        const primaryColor = squadPlayer.PrimaryHex || '#333';
        const secondaryColor = squadPlayer.SecondaryHex || '#666';

        slot.innerHTML = `
            <div class="shirt">
                ${createShirtSVG(primaryColor, secondaryColor)}
                ${squadPlayer.Captain === 'TRUE' ? '<span class="badge">C</span>' : ''}
                ${squadPlayer.ViceCaptain === 'TRUE' && squadPlayer.Captain !== 'TRUE' ? '<span class="badge vice">V</span>' : ''}
                ${displayScore !== null ? `<span class="shirt-score ${isDNP ? 'dnp' : ''}">${displayScore}</span>` : ''}
            </div>
            <span class="player-name">${formatPlayerName(squadPlayer.Name)}</span>
        `;
    } else {
        slot.classList.add('empty');
        const accepts = SLOT_ACCEPTS[slotInfo.type] || [slotInfo.type];
        const label = accepts.length > 1 ? accepts.join('/') : accepts[0];
        slot.innerHTML = `
            <div class="shirt">${createShirtSVG('#444', '#666')}</div>
            <span class="player-name">${label}</span>
        `;
    }

    slot.addEventListener('click', () => handleSlotClick(slot, slotInfo, squadPlayer, playerName));
    return slot;
}

function renderTeam(playerName) {
    const squad = playerName === 'David' ? state.davidSquad : state.ellSquad;
    const formation = getFormationForPlayer(playerName);
    const prefix = playerName.toLowerCase();
    const config = FORMATIONS[formation] || FORMATIONS['4-4-2'];

    // Generate all slots
    const allSlots = generateSlotsForFormation(formation);

    // Group by row
    const rowGroups = {};
    for (const s of allSlots) {
        if (!rowGroups[s.row]) rowGroups[s.row] = [];
        rowGroups[s.row].push(s);
    }

    const rowKeys = Object.keys(rowGroups).sort((a, b) => a - b);

    // We have 5 pitch row divs per half: gk, def, mfdf, fwmf, fwd
    const rowIds = ['gk', 'def', 'mfdf', 'fwmf', 'fwd'];

    if (playerName === 'Ell') {
        // Ell: GK at top, FWD near halfway
        for (let i = 0; i < rowIds.length; i++) {
            const rowEl = document.getElementById(`${prefix}-${rowIds[i]}`);
            rowEl.innerHTML = '';
            if (i < rowKeys.length) {
                const slots = rowGroups[rowKeys[i]];
                for (const s of slots) {
                    const slotKey = `${s.type}${s.num}`;
                    const sp = squad.find(p => p.Slot === slotKey);
                    rowEl.appendChild(renderPlayerSlot(s, sp, playerName, squad));
                }
            }
        }
    } else {
        // David: FWD at top (near halfway), GK at bottom
        // HTML row order top-to-bottom: fwd, fwmf, mfdf, def, gk
        const davidRowIds = ['fwd', 'fwmf', 'mfdf', 'def', 'gk'];
        const reversed = [...rowKeys].reverse();
        for (let i = 0; i < davidRowIds.length; i++) {
            const rowEl = document.getElementById(`${prefix}-${davidRowIds[i]}`);
            rowEl.innerHTML = '';
            if (i < reversed.length) {
                const slots = rowGroups[reversed[i]];
                for (const s of slots) {
                    const slotKey = `${s.type}${s.num}`;
                    const sp = squad.find(p => p.Slot === slotKey);
                    rowEl.appendChild(renderPlayerSlot(s, sp, playerName, squad));
                }
            }
        }
    }

    // Render bench
    const benchArea = document.getElementById(`${prefix}-bench`);
    benchArea.querySelectorAll('.bench-slot').forEach(slotEl => {
        const slotKey = slotEl.dataset.slot;
        const sp = squad.find(p => p.Slot === slotKey);

        slotEl.innerHTML = '';
        slotEl.classList.remove('filled', 'dnp');

        if (sp && sp.Name) {
            slotEl.classList.add('filled');
            if (sp.Score === 'X') slotEl.classList.add('dnp');
            const displayScore = getDisplayScore(sp, squad, playerName);
            slotEl.innerHTML = `
                <div class="shirt">
                    ${createShirtSVG(sp.PrimaryHex || '#333', sp.SecondaryHex || '#666')}
                    ${displayScore !== null ? `<span class="shirt-score ${sp.Score === 'X' ? 'dnp' : ''}">${displayScore}</span>` : ''}
                </div>
                <span class="player-name">${formatPlayerName(sp.Name)}</span>
            `;
        } else {
            slotEl.innerHTML = `<span class="player-name">BENCH</span>`;
        }

        const newEl = slotEl.cloneNode(true);
        slotEl.parentNode.replaceChild(newEl, slotEl);
        newEl.addEventListener('click', () => {
            handleSlotClick(newEl, { type: 'BENCH', num: parseInt(slotKey.replace('BENCH', '')) }, sp, playerName);
        });
    });
}

function calculateTeamScore(squad, playerName) {
    const starters = squad.filter(p => p.Starting === 'TRUE');
    const bench = squad.filter(p => p.Starting === 'FALSE');

    const anyScores = squad.some(p => p.Score !== undefined && p.Score !== '');
    if (!anyScores) return { valid: true, score: 0 };

    const bbActive = getChipState(playerName, 'BB') === 'active';
    const tcActive = getChipState(playerName, 'TC') === 'active';

    let total = 0;
    const captain = squad.find(p => p.Captain === 'TRUE');
    const viceCaptain = squad.find(p => p.ViceCaptain === 'TRUE');
    const captainScore = captain ? String(captain.Score ?? '') : '';
    const captainPlayed = captain && captainScore !== 'X';
    // Captain multiplier: TC active = x3, otherwise x2
    const captainMultiplier = tcActive ? 3 : 2;
    const usedSubs = new Set();

    for (const player of starters) {
        let score = 0;

        const playerScore = String(player.Score ?? '');
        if (playerScore === 'X') {
            // DNP substitution logic (only when Bench Boost is NOT active)
            if (!bbActive) {
                const playerPos = player.Position;
                const availableBench = bench
                    .filter(bp => {
                        const bpScore = String(bp.Score ?? '');
                        return !usedSubs.has(bp.Name) && bpScore !== 'X' && bpScore !== '';
                    });

                const samePos = availableBench
                    .filter(bp => bp.Position === playerPos)
                    .sort((a, b) => parseFloat(b.Score) - parseFloat(a.Score));

                if (samePos.length > 0) {
                    score = parseFloat(samePos[0].Score) || 0;
                    usedSubs.add(samePos[0].Name);
                } else if (playerPos !== 'GK') {
                    const anyPos = availableBench
                        .sort((a, b) => parseFloat(b.Score) - parseFloat(a.Score));
                    if (anyPos.length > 0) {
                        score = parseFloat(anyPos[0].Score) || 0;
                        usedSubs.add(anyPos[0].Name);
                    }
                }
            }
        } else if (playerScore !== '') {
            score = parseFloat(playerScore) || 0;
        }

        if (playerScore !== 'X') {
            if (captainPlayed) {
                // Captain played: captain gets 2x/3x, VC gets 1.5x
                if (captain && player.Name === captain.Name) {
                    score *= captainMultiplier;
                } else if (viceCaptain && player.Name === viceCaptain.Name) {
                    score *= 1.5;
                }
            } else {
                // Captain didn't play: VC becomes effective captain at 2x/3x
                if (viceCaptain && player.Name === viceCaptain.Name) {
                    score *= captainMultiplier;
                }
            }
        }
        total += score;
    }

    // Bench Boost: add all bench player scores directly
    if (bbActive) {
        for (const bp of bench) {
            if (bp.Score && bp.Score !== 'X' && bp.Score !== '') {
                total += parseFloat(bp.Score) || 0;
            }
        }
    }

    return { valid: true, score: total };
}

function getChipState(playerName, chipType) {
    return state.settings[`${playerName}${chipType}`] || 'inactive';
}

function renderChips(playerName) {
    for (const chip of ['BB', 'TC']) {
        const btn = document.getElementById(`${playerName.toLowerCase()}-${chip.toLowerCase()}`);
        const chipState = getChipState(playerName, chip);
        btn.classList.remove('active', 'used');
        if (chipState === 'active') btn.classList.add('active');
        else if (chipState === 'used') btn.classList.add('used');
    }
    // Transfer chip: value is "0", "1", or "2"
    const tfBtn = document.getElementById(`${playerName.toLowerCase()}-tf`);
    const tfValue = state.settings[`${playerName}TF`] || '0';
    tfBtn.textContent = tfValue;
    tfBtn.classList.remove('active', 'used');
    if (tfValue === '1' || tfValue === '2') tfBtn.classList.add('active');
    else tfBtn.classList.add('used');
}

function renderScoreboard() {
    const dr = calculateTeamScore(state.davidSquad, 'David');
    const er = calculateTeamScore(state.ellSquad, 'Ell');
    const dEl = document.getElementById('david-score');
    const eEl = document.getElementById('ell-score');

    dEl.textContent = dr.valid ? dr.score : '?';
    dEl.classList.toggle('invalid', !dr.valid);
    eEl.textContent = er.valid ? er.score : '?';
    eEl.classList.toggle('invalid', !er.valid);
}

function renderAll() {
    renderManagerCard('David');
    renderManagerCard('Ell');
    renderBudget('David');
    renderBudget('Ell');
    renderChips('David');
    renderChips('Ell');
    renderTeam('David');
    renderTeam('Ell');
    renderScoreboard();
}

// === Modal ===
function showModal(content) {
    const modal = document.getElementById('modal');
    modal.querySelector('.modal-content').innerHTML = content;
    modal.classList.remove('hidden');
    modal.querySelector('.modal-backdrop').onclick = hideModal;
}

function hideModal() {
    document.getElementById('modal').classList.add('hidden');
}

// === Slot Click ===
function handleSlotClick(slotEl, slotInfo, squadPlayer, playerName) {
    if (squadPlayer && squadPlayer.Name) {
        showFilledSlotModal(squadPlayer, slotInfo, playerName);
    } else {
        showEmptySlotModal(slotInfo, playerName);
    }
}

function showEmptySlotModal(slotInfo, playerName) {
    const accepts = SLOT_ACCEPTS[slotInfo.type] || [slotInfo.type];
    const squad = playerName === 'David' ? state.davidSquad : state.ellSquad;

    // Check squad size limit
    if (squad.length >= MAX_SQUAD_SIZE) {
        showToast('Squad is full (max 15 players)');
        return;
    }

    const squadNames = squad.map(p => p.Name);

    // Filter available players (correct position, not already in squad)
    const availablePlayers = state.players.filter(p =>
        accepts.includes(p.Position) && !squadNames.includes(p.Name)
    );

    // Also filter clubs that are already at max
    const clubCounts = {};
    for (const p of squad) { clubCounts[p.Club] = (clubCounts[p.Club] || 0) + 1; }

    const clubOptions = [...new Set(availablePlayers.map(p => p.Club))].sort();

    showModal(`
        <div class="modal-header">
            <h3 class="modal-title">Add Player</h3>
            <button class="modal-close" onclick="hideModal()">×</button>
        </div>
        <div class="form-group">
            <label class="form-label">Club</label>
            <select class="form-select" id="modal-club">
                <option value="">Select Club...</option>
                ${clubOptions.map(c => {
                    const count = clubCounts[c] || 0;
                    const full = count >= MAX_PER_CLUB;
                    return `<option value="${c}" ${full ? 'disabled' : ''}>${c}${full ? ' (full)' : ` (${count}/${MAX_PER_CLUB})`}</option>`;
                }).join('')}
            </select>
        </div>
        <div class="form-group">
            <label class="form-label">Player</label>
            <select class="form-select" id="modal-player" disabled>
                <option value="">Select Club First...</option>
            </select>
        </div>
        <div class="form-group">
            <label class="form-label">Position</label>
            <div class="form-value" id="modal-position">-</div>
        </div>
        <div class="form-group">
            <label class="form-label">Value</label>
            <div class="form-value" id="modal-value">-</div>
        </div>
        <div id="modal-error" class="error-message hidden"></div>
        <div class="btn-group">
            <button class="btn btn-secondary" onclick="hideModal()">Cancel</button>
            <button class="btn btn-primary" id="modal-confirm" disabled>Add Player</button>
        </div>
    `);

    document.getElementById('modal-club').addEventListener('change', (e) => {
        const club = e.target.value;
        const playerSelect = document.getElementById('modal-player');
        if (!club) {
            playerSelect.innerHTML = '<option value="">Select Club First...</option>';
            playerSelect.disabled = true;
            document.getElementById('modal-confirm').disabled = true;
            return;
        }
        const clubPlayers = availablePlayers.filter(p => p.Club === club)
            .sort((a, b) => parseFloat(b.GameValue) - parseFloat(a.GameValue));
        playerSelect.innerHTML = `
            <option value="">Select Player...</option>
            ${clubPlayers.map(p => `<option value="${p.Name}">${p.Name} (${p.Position}) - ${formatCurrency(p.GameValue)}</option>`).join('')}
        `;
        playerSelect.disabled = false;
    });

    document.getElementById('modal-player').addEventListener('change', (e) => {
        const pName = e.target.value;
        const p = state.players.find(x => x.Name === pName);
        if (p) {
            document.getElementById('modal-position').textContent = p.Position;
            document.getElementById('modal-value').textContent = formatCurrency(p.GameValue);
            document.getElementById('modal-confirm').disabled = false;
        } else {
            document.getElementById('modal-position').textContent = '-';
            document.getElementById('modal-value').textContent = '-';
            document.getElementById('modal-confirm').disabled = true;
        }
    });

    document.getElementById('modal-confirm').addEventListener('click', async () => {
        if (isSaving) return;
        const selPlayer = document.getElementById('modal-player').value;
        const p = state.players.find(x => x.Name === selPlayer);
        if (!p) return;

        const remaining = parseFloat(state.settings[`${playerName}Remaining`]) || 0;
        if (parseFloat(p.GameValue) > remaining) {
            document.getElementById('modal-error').textContent = 'Not enough budget!';
            document.getElementById('modal-error').classList.remove('hidden');
            return;
        }

        // Check club limit
        const clubCount = getClubCount(squad, p.Club);
        if (clubCount >= MAX_PER_CLUB) {
            document.getElementById('modal-error').textContent = `Max ${MAX_PER_CLUB} players per club!`;
            document.getElementById('modal-error').classList.remove('hidden');
            return;
        }

        isSaving = true;
        document.getElementById('modal-confirm').disabled = true;
        document.getElementById('modal-confirm').textContent = 'Adding...';

        try {
            await postData('squadAdd', {
                player: playerName,
                playerData: {
                    Name: p.Name,
                    Slot: `${slotInfo.type}${slotInfo.num}`,
                    Starting: slotInfo.type !== 'BENCH' ? 'TRUE' : 'FALSE',
                    Captain: 'FALSE', ViceCaptain: 'FALSE', Score: ''
                }
            });
            await loadAllData();
            renderAll();
            hideModal();
            showToast(`${p.Name} added`);
        } catch (err) {
            document.getElementById('modal-error').textContent = 'Failed to add player';
            document.getElementById('modal-error').classList.remove('hidden');
            document.getElementById('modal-confirm').disabled = false;
            document.getElementById('modal-confirm').textContent = 'Add Player';
        } finally {
            isSaving = false;
        }
    });
}

function getSwapTargets(squadPlayer, slotInfo, playerName) {
    const squad = playerName === 'David' ? state.davidSquad : state.ellSquad;
    const formation = getFormationForPlayer(playerName);
    const allSlots = generateSlotsForFormation(formation);
    const isBenched = slotInfo.type === 'BENCH';

    if (isBenched) {
        // Bench player: find field slots AND other bench players to swap with
        const targets = [];

        // 1. Field slots that accept this player's position
        for (const fieldSlot of allSlots) {
            const accepts = SLOT_ACCEPTS[fieldSlot.type] || [];
            if (!accepts.includes(squadPlayer.Position)) continue;
            const slotKey = `${fieldSlot.type}${fieldSlot.num}`;
            const occupant = squad.find(p => p.Slot === slotKey);
            if (!occupant || !occupant.Name) {
                targets.push({ slot: fieldSlot, occupant: null, label: `${slotKey} (empty)` });
            } else {
                targets.push({ slot: fieldSlot, occupant, label: `${slotKey} - ${occupant.Name}` });
            }
        }

        // 2. Other bench players (swap bench positions to reorder)
        const currentBenchNum = slotInfo.num;
        const benchPlayers = squad.filter(p => p.Starting === 'FALSE' && p.Name && p.Name !== squadPlayer.Name);
        for (const bp of benchPlayers) {
            const bpNum = parseInt(bp.Slot.replace('BENCH', ''));
            targets.push({ slot: { type: 'BENCH', num: bpNum }, occupant: bp, label: `BENCH - ${bp.Name} (${bp.Position})` });
        }

        return targets;
    } else {
        // Field player: find bench AND field swap targets
        const targets = [];
        const benchPlayers = squad.filter(p => p.Starting === 'FALSE');
        const accepts = SLOT_ACCEPTS[slotInfo.type] || [];

        // 1. Bench players that can fill THIS slot
        for (const bp of benchPlayers) {
            if (bp.Name && accepts.includes(bp.Position)) {
                targets.push({ slot: { type: 'BENCH', num: parseInt(bp.Slot.replace('BENCH', '')) }, occupant: bp, label: `BENCH - ${bp.Name} (${bp.Position})` });
            }
        }

        // 2. Other field slots this player could move to
        const currentSlotKey = `${slotInfo.type}${slotInfo.num}`;
        for (const fieldSlot of allSlots) {
            const targetSlotKey = `${fieldSlot.type}${fieldSlot.num}`;
            if (targetSlotKey === currentSlotKey) continue; // skip self

            const targetAccepts = SLOT_ACCEPTS[fieldSlot.type] || [];
            if (!targetAccepts.includes(squadPlayer.Position)) continue; // player can't go there

            const occupant = squad.find(p => p.Slot === targetSlotKey);

            if (!occupant || !occupant.Name) {
                // Empty field slot — player moves there, old slot becomes empty
                targets.push({ slot: fieldSlot, occupant: null, label: `${targetSlotKey} (empty)` });
            } else {
                // Occupied — only offer if occupant can also fill the current slot (bidirectional)
                if (accepts.includes(occupant.Position)) {
                    targets.push({ slot: fieldSlot, occupant, label: `${targetSlotKey} - ${occupant.Name} (${occupant.Position})` });
                }
            }
        }

        return targets;
    }
}

function showFilledSlotModal(squadPlayer, slotInfo, playerName) {
    const p = state.players.find(x => x.Name === squadPlayer.Name);
    const primary = p?.PrimaryHex || '#333';
    const secondary = p?.SecondaryHex || '#666';
    const isBenched = slotInfo.type === 'BENCH';
    const swapTargets = getSwapTargets(squadPlayer, slotInfo, playerName);

    const swapLabel = 'Swap / Move';
    const swapOptions = swapTargets.length > 0
        ? `<div class="form-group">
            <label class="form-label">${swapLabel}</label>
            <select class="form-select" id="modal-swap">
                <option value="">Select...</option>
                ${swapTargets.map((t, i) => `<option value="${i}">${t.label}</option>`).join('')}
            </select>
           </div>`
        : '';

    const scoringElements = getScoringElements(squadPlayer.Position);

    showModal(`
        <div class="modal-header">
            <h3 class="modal-title">Player Details</h3>
            <button class="modal-close" onclick="hideModal()">×</button>
        </div>
        <div class="player-display">
            <div class="shirt">${createShirtSVG(primary, secondary)}</div>
            <div class="player-display-info">
                <div class="player-display-name">${squadPlayer.Name}</div>
                <div class="player-display-details">${squadPlayer.Club} · ${squadPlayer.Position} · ${formatCurrency(squadPlayer.GameValue)}</div>
            </div>
        </div>
        ${swapOptions}
        <div class="form-group">
            <label class="form-label">Score</label>
            <div class="scoring-elements ${squadPlayer.Score === 'X' ? 'disabled' : ''}" id="modal-scoring">
                ${scoringElements.map(el => `
                    <div class="scoring-row" data-key="${el.key}">
                        <span class="scoring-icon">${el.icon}</span>
                        <span class="scoring-label">${el.label}</span>
                        <span class="scoring-points">${el.points > 0 ? '+' : ''}${el.points}</span>
                        <div class="scoring-controls">
                            <button class="scoring-btn scoring-minus" data-key="${el.key}">−</button>
                            <span class="scoring-count" id="count-${el.key}">0</span>
                            <button class="scoring-btn scoring-plus" data-key="${el.key}">+</button>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="score-total-row">
                <button class="score-reset-btn" id="modal-reset">Reset</button>
                <div class="score-total-label">Total</div>
                <div class="score-total-value" id="modal-score-total">0</div>
                <button class="dnp-btn ${squadPlayer.Score === 'X' ? 'active' : ''}" id="modal-dnp">DNP</button>
            </div>
        </div>
        <div class="toggle-group">
            <button class="toggle-btn ${squadPlayer.Captain === 'TRUE' ? 'active' : ''}" id="modal-captain">Captain</button>
            <button class="toggle-btn ${squadPlayer.ViceCaptain === 'TRUE' ? 'active' : ''}" id="modal-vice">Vice Captain</button>
        </div>
        <div id="modal-error" class="error-message hidden"></div>
        <div class="btn-group">
            <button class="btn btn-danger" id="modal-remove">Remove</button>
            <button class="btn btn-primary" id="modal-save">Save</button>
        </div>
    `);

    // Scoring element counts
    const scoreCounts = {};
    for (const el of scoringElements) {
        scoreCounts[el.key] = 0;
    }

    // If there's an existing numeric score, we can't perfectly reverse-engineer the elements,
    // but we'll show it as the total. User can adjust from zero.
    const existingScore = squadPlayer.Score !== 'X' && squadPlayer.Score !== '' && squadPlayer.Score !== undefined
        ? parseFloat(squadPlayer.Score) || 0 : 0;
    // Show existing score in the total display
    let manualOffset = existingScore; // tracks score that isn't from element buttons

    function updateScoreDisplay() {
        const elementTotal = calculateScoreFromElements(scoreCounts, scoringElements);
        const total = elementTotal + manualOffset;
        document.getElementById('modal-score-total').textContent = total;
    }

    updateScoreDisplay();

    // Wire up +/- buttons
    document.querySelectorAll('.scoring-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (document.getElementById('modal-dnp').classList.contains('active')) return;
            const key = btn.dataset.key;
            const isPlus = btn.classList.contains('scoring-plus');
            if (isPlus) {
                scoreCounts[key] = (scoreCounts[key] || 0) + 1;
                // First increment clears the manual offset (user is now using buttons)
                if (manualOffset !== 0) {
                    manualOffset = 0;
                }
            } else {
                if ((scoreCounts[key] || 0) > 0) {
                    scoreCounts[key]--;
                }
            }
            document.getElementById(`count-${key}`).textContent = scoreCounts[key] || 0;
            updateScoreDisplay();
        });
    });

    document.getElementById('modal-dnp').addEventListener('click', (e) => {
        e.target.classList.toggle('active');
        const scoringEl = document.getElementById('modal-scoring');
        if (e.target.classList.contains('active')) {
            scoringEl.classList.add('disabled');
            document.getElementById('modal-score-total').textContent = 'X';
        } else {
            scoringEl.classList.remove('disabled');
            updateScoreDisplay();
        }
    });

    document.getElementById('modal-reset').addEventListener('click', () => {
        for (const el of scoringElements) {
            scoreCounts[el.key] = 0;
            document.getElementById(`count-${el.key}`).textContent = '0';
        }
        manualOffset = 0;
        document.getElementById('modal-dnp').classList.remove('active');
        document.getElementById('modal-scoring').classList.remove('disabled');
        updateScoreDisplay();
    });

    document.getElementById('modal-captain').addEventListener('click', (e) => {
        e.target.classList.toggle('active');
        if (e.target.classList.contains('active')) document.getElementById('modal-vice').classList.remove('active');
    });

    document.getElementById('modal-vice').addEventListener('click', (e) => {
        e.target.classList.toggle('active');
        if (e.target.classList.contains('active')) document.getElementById('modal-captain').classList.remove('active');
    });

    document.getElementById('modal-save').addEventListener('click', async () => {
        if (isSaving) return;
        isSaving = true;
        const saveBtn = document.getElementById('modal-save');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        let score;
        if (document.getElementById('modal-dnp').classList.contains('active')) {
            score = 'X';
        } else {
            const elementTotal = calculateScoreFromElements(scoreCounts, scoringElements);
            const total = elementTotal + manualOffset;
            score = total !== 0 ? String(total) : (Object.values(scoreCounts).some(v => v > 0) ? '0' : '');
        }
        const isCaptain = document.getElementById('modal-captain').classList.contains('active');
        const isVice = document.getElementById('modal-vice').classList.contains('active');

        // Check if a swap was selected
        const swapSelect = document.getElementById('modal-swap');
        const swapIdx = swapSelect ? swapSelect.value : '';

        try {
            // Perform swap if selected
            if (swapIdx !== '') {
                const target = swapTargets[parseInt(swapIdx)];
                const currentSlot = squadPlayer.Slot;
                const currentStarting = squadPlayer.Starting;

                if (target.occupant) {
                    // Swap two players' slots
                    const targetSlot = target.occupant.Slot;
                    const targetStarting = target.occupant.Starting;
                    await postData('squadUpdate', {
                        player: playerName,
                        playerName: squadPlayer.Name,
                        updates: { Slot: targetSlot, Starting: targetStarting }
                    });
                    await postData('squadUpdate', {
                        player: playerName,
                        playerName: target.occupant.Name,
                        updates: { Slot: currentSlot, Starting: currentStarting }
                    });
                } else {
                    // Move into empty field slot
                    const newSlot = `${target.slot.type}${target.slot.num}`;
                    await postData('squadUpdate', {
                        player: playerName,
                        playerName: squadPlayer.Name,
                        updates: { Slot: newSlot, Starting: 'TRUE' }
                    });
                }
            }

            // Save score/captain/vc
            await postData('squadUpdate', {
                player: playerName,
                playerName: squadPlayer.Name,
                updates: { Score: score, Captain: isCaptain ? 'TRUE' : 'FALSE', ViceCaptain: isVice ? 'TRUE' : 'FALSE' }
            });
            await loadAllData();
            renderAll();
            hideModal();
            showToast(swapIdx !== '' ? 'Swapped & saved' : 'Saved');
        } catch (err) {
            document.getElementById('modal-error').textContent = 'Failed to save';
            document.getElementById('modal-error').classList.remove('hidden');
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
        } finally {
            isSaving = false;
        }
    });

    document.getElementById('modal-remove').addEventListener('click', async () => {
        if (isSaving) return;
        isSaving = true;
        const removeBtn = document.getElementById('modal-remove');
        removeBtn.disabled = true;
        removeBtn.textContent = 'Removing...';

        try {
            await postData('squadRemove', { player: playerName, playerName: squadPlayer.Name });
            await loadAllData();
            renderAll();
            hideModal();
            showToast(`${squadPlayer.Name} removed`);
        } catch (err) {
            document.getElementById('modal-error').textContent = 'Failed to remove';
            document.getElementById('modal-error').classList.remove('hidden');
            removeBtn.disabled = false;
            removeBtn.textContent = 'Remove';
        } finally {
            isSaving = false;
        }
    });
}

// === Manager Modal ===
function showManagerModal(playerName) {
    const currentManager = state.settings[`${playerName}Manager`];

    showModal(`
        <div class="modal-header">
            <h3 class="modal-title">Select Manager</h3>
            <button class="modal-close" onclick="hideModal()">×</button>
        </div>
        <div class="form-group">
            <label class="form-label">Manager</label>
            <select class="form-select" id="modal-manager">
                <option value="">Select Manager...</option>
                ${state.managers.map(m => `
                    <option value="${m.Name}" ${m.Name === currentManager ? 'selected' : ''}>
                        ${m.Name} (${m.Club}) - ${m.Formation}
                    </option>
                `).join('')}
            </select>
        </div>
        <div class="form-group">
            <label class="form-label">Formation</label>
            <div class="form-value" id="modal-formation">${state.managers.find(m => m.Name === currentManager)?.Formation || '-'}</div>
        </div>
        <div id="modal-error" class="error-message hidden"></div>
        <div class="btn-group">
            <button class="btn btn-secondary" onclick="hideModal()">Cancel</button>
            <button class="btn btn-primary" id="modal-confirm">Confirm</button>
        </div>
    `);

    document.getElementById('modal-manager').addEventListener('change', (e) => {
        const mgr = state.managers.find(m => m.Name === e.target.value);
        document.getElementById('modal-formation').textContent = mgr?.Formation || '-';
    });

    document.getElementById('modal-confirm').addEventListener('click', async () => {
        if (isSaving) return;
        isSaving = true;
        const btn = document.getElementById('modal-confirm');
        btn.disabled = true;
        btn.textContent = 'Saving...';

        const newManagerName = document.getElementById('modal-manager').value;
        const newMgr = state.managers.find(m => m.Name === newManagerName);
        const newFormation = newMgr?.Formation || '4-4-2';
        const oldFormation = getFormationForPlayer(playerName);

        try {
            // Update manager in settings
            await postData('settingsManager', { player: playerName, manager: newManagerName });

            // If formation changed and squad has players, remap them
            const squad = playerName === 'David' ? state.davidSquad : state.ellSquad;
            if (oldFormation !== newFormation && squad.length > 0) {
                const remapped = remapPlayersForFormation(squad, oldFormation, newFormation);
                await postData('squadRemap', { player: playerName, squad: remapped });
            }

            await loadAllData();
            renderAll();
            hideModal();
            showToast('Manager updated');
        } catch (err) {
            document.getElementById('modal-error').textContent = 'Failed to update';
            document.getElementById('modal-error').classList.remove('hidden');
            btn.disabled = false;
            btn.textContent = 'Confirm';
        } finally {
            isSaving = false;
        }
    });
}

// === Event Listeners ===
function setupEventListeners() {
    document.getElementById('david-manager').addEventListener('click', () => showManagerModal('David'));
    document.getElementById('ell-manager').addEventListener('click', () => showManagerModal('Ell'));

    // Chip buttons (BB and TC) - cycle: inactive -> active -> used -> inactive
    for (const player of ['David', 'Ell']) {
        for (const chip of ['BB', 'TC']) {
            const btnId = `${player.toLowerCase()}-${chip.toLowerCase()}`;
            document.getElementById(btnId).addEventListener('click', async () => {
                const btn = document.getElementById(btnId);
                const current = getChipState(player, chip);
                const next = current === 'inactive' ? 'active' : current === 'active' ? 'used' : 'inactive';

                btn.disabled = true;
                try {
                    await postData('settingsChip', { player, chipType: chip, chipState: next });
                    state.settings[`${player}${chip}`] = next;
                    renderChips(player);
                    renderScoreboard();
                    renderTeam(player);
                } catch (err) {
                    showToast('Failed to update chip');
                } finally {
                    btn.disabled = false;
                }
            });
        }

        // Transfer button (TF) - cycle: 2 -> 1 -> 0 -> 2
        const tfBtnId = `${player.toLowerCase()}-tf`;
        document.getElementById(tfBtnId).addEventListener('click', async () => {
            const btn = document.getElementById(tfBtnId);
            const current = state.settings[`${player}TF`] || '0';
            const next = current === '2' ? '1' : current === '1' ? '0' : '2';

            btn.disabled = true;
            try {
                await postData('settingsChip', { player, chipType: 'TF', chipState: next });
                state.settings[`${player}TF`] = next;
                renderChips(player);
            } catch (err) {
                showToast('Failed to update transfers');
            } finally {
                btn.disabled = false;
            }
        });

        // Clear scores button
        const clearBtnId = `${player.toLowerCase()}-clear`;
        document.getElementById(clearBtnId).addEventListener('click', async () => {
            const btn = document.getElementById(clearBtnId);
            btn.disabled = true;
            btn.textContent = '...';
            try {
                await postData('squadClearScores', { player });
                await loadAllData();
                renderAll();
                showToast(`${player}'s scores cleared`);
            } catch (err) {
                showToast('Failed to clear scores');
            } finally {
                btn.disabled = false;
                btn.textContent = 'CLR';
            }
        });
    }

}

// === Initialize ===
async function init() {
    try {
        await loadAllData();
        renderAll();
        setupEventListeners();
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('game-container').classList.remove('hidden');
    } catch (error) {
        console.error('Failed to initialize:', error);
        document.getElementById('loading').innerHTML = `
            <p style="color:#ff4a4a;">Failed to load game data</p>
            <p style="color:#aaa;font-size:14px;">Check console for details</p>
            <button onclick="location.reload()" style="margin-top:20px;padding:10px 20px;background:#4a9eff;border:none;border-radius:8px;color:white;cursor:pointer;">Retry</button>
        `;
    }
}

document.addEventListener('DOMContentLoaded', init);
