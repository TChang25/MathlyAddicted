import { ref, set, get, onValue, off, update, remove, onDisconnect, query, orderByChild, endAt } from "firebase/database";
import { database } from "./firebaseConfig";

// Helper to clean up old rooms (Lazy Cleanup)
const cleanupOldRooms = async () => {
  const CUTOFF_TIME = Date.now() - (2 * 60 * 60 * 1000); // 2 hours
  const roomsRef = ref(database, 'rooms');
  const oldRoomsQuery = query(roomsRef, orderByChild('createdAt'), endAt(CUTOFF_TIME));

  try {
    const snapshot = await get(oldRoomsQuery);
    if (snapshot.exists()) {
      const updates = {};
      snapshot.forEach((child) => {
        updates[child.key] = null;
      });
      await update(roomsRef, updates);
    }
  } catch (error) {
    console.log("Lazy cleanup failed:", error);
  }
};

// Generate a random 8-character room code
export const generateRoomCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Removed ambiguous characters
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

// Create a new room
export const createRoom = async (roomCode, hostNickname, settings) => {
  // Trigger lazy cleanup (fire and forget)
  cleanupOldRooms();

  const roomRef = ref(database, `rooms/${roomCode}`);
  const hostId = Math.random().toString(36).substring(7);
  
  const roomData = {
    roomCode,
    status: "waiting",
    hostId,
    settings: {
      operations: settings.operations || ['+'],
      isZenMode: settings.isZenMode || false,
      minNumber: settings.minNumber ?? 0, // Default to 0 if not provided
      maxNumber: settings.maxNumber ?? 12, // Default to 12 if not provided
    },
    players: {
      [hostId]: {
        nickname: hostNickname.substring(0, 12),
        score: 0,
        isHost: true,
        status: "not_ready",
        isFinished: false
      }
    },
    currentQuestion: null,
    createdAt: Date.now(),
  };

  // Ensure host is removed if they disconnect
  const playerRef = ref(database, `rooms/${roomCode}/players/${hostId}`);
  onDisconnect(playerRef).remove();

  await set(roomRef, roomData);
  return hostId;
};

// Join an existing room
export const joinRoom = async (roomCode, nickname) => {
  const roomRef = ref(database, `rooms/${roomCode}`);
  const snapshot = await get(roomRef);

  if (!snapshot.exists()) {
    throw new Error("Room not found");
  }

  const roomData = snapshot.val();
  if (roomData.status !== "waiting") {
    throw new Error("Game already in progress");
  }

  const playerId = Math.random().toString(36).substring(7);
  const playerRef = ref(database, `rooms/${roomCode}/players/${playerId}`);
  
  await set(playerRef, {
    nickname: nickname.substring(0, 12),
    score: 0,
    isHost: false,
    status: "not_ready",
    isFinished: false
  });

  // Ensure player is removed if they disconnect
  onDisconnect(playerRef).remove();

  return playerId;
};

// Listen for room updates
export const subscribeToRoom = (roomCode, callback) => {
  const roomRef = ref(database, `rooms/${roomCode}`);
  onValue(roomRef, (snapshot) => {
    callback(snapshot.val());
  });
  return () => off(roomRef);
};

// Update player status
export const updatePlayerStatus = async (roomCode, playerId, status) => {
  const statusRef = ref(database, `rooms/${roomCode}/players/${playerId}`);
  await update(statusRef, { status });
};

// Update room settings (Host only)
export const updateRoomSettings = async (roomCode, settings) => {
  const settingsRef = ref(database, `rooms/${roomCode}/settings`);
  await update(settingsRef, settings);
};

// Start game (Host only)
export const startGame = async (roomCode) => {
  const roomRef = ref(database, `rooms/${roomCode}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists()) return;

  // Reset finish status and set all to playing for round start
  const players = snapshot.val().players;
  const resetPlayers = {};
  Object.keys(players).forEach(id => {
    resetPlayers[id] = { ...players[id], isFinished: false, score: 0, status: "playing" };
  });

  // Generate a random seed for synchronized questions
  const seed = Math.floor(Math.random() * 1000000);

  await update(roomRef, {
    status: "playing",
    startTime: Date.now(),
    players: resetPlayers,
    seed: seed
  });
};

// End game
export const finishGame = async (roomCode) => {
  const roomRef = ref(database, `rooms/${roomCode}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists()) return;

  const players = snapshot.val().players;
  const updatedPlayers = {};
  Object.keys(players).forEach(id => {
    updatedPlayers[id] = { ...players[id], status: "viewing_scores" };
  });

  await update(roomRef, {
    status: "finished",
    players: updatedPlayers
  });
};

// Restart game (Reset scores and status)
export const restartGame = async (roomCode) => {
  const roomRef = ref(database, `rooms/${roomCode}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists()) return;
  
  const players = snapshot.val().players;
  const updatedPlayers = {};
  Object.keys(players).forEach(id => {
    updatedPlayers[id] = { 
      nickname: players[id].nickname,
      isHost: players[id].isHost,
      score: 0, 
      isFinished: false,
      status: "not_ready"
    };
  });

  await update(roomRef, {
    status: "waiting",
    players: updatedPlayers,
    currentQuestion: null,
    startTime: null,
    endTime: null,
  });
};

// Update player score and mark as finished
export const updatePlayerScore = async (roomCode, playerId, newScore) => {
  const playerRef = ref(database, `rooms/${roomCode}/players/${playerId}`);
  await update(playerRef, { 
    score: newScore,
    isFinished: true,
    status: "finished"
  });
};

// Sync player score in real-time
export const syncPlayerScore = async (roomCode, playerId, score) => {
  const scoreRef = ref(database, `rooms/${roomCode}/players/${playerId}`);
  await update(scoreRef, { score });
};

// Transfer host to a new player
export const transferHost = async (roomCode, newHostId) => {
  const roomRef = ref(database, `rooms/${roomCode}`);
  const updates = {};
  updates['hostId'] = newHostId;
  updates[`players/${newHostId}/isHost`] = true;
  await update(roomRef, updates);
};

// Leave room
export const leaveRoom = async (roomCode, playerId, isHost) => {
  const roomRef = ref(database, `rooms/${roomCode}`);
  const playerRef = ref(database, `rooms/${roomCode}/players/${playerId}`);
  
  // Cancel onDisconnect
  onDisconnect(playerRef).cancel();

  if (isHost) {
    const snapshot = await get(roomRef);
    if (snapshot.exists()) {
      const roomData = snapshot.val();
      const players = roomData.players || {};
      const remainingPlayerIds = Object.keys(players).filter(id => id !== playerId);

      if (remainingPlayerIds.length > 0) {
        // Transfer host before leaving
        const newHostId = remainingPlayerIds[0];
        await transferHost(roomCode, newHostId);
        await remove(playerRef);
      } else {
        // No one else left, delete room
        await remove(roomRef);
      }
    }
  } else {
    // If player leaves, just remove them
    await remove(playerRef);
  }
};

// Kick player (Host only)
export const kickPlayer = async (roomCode, playerId) => {
  const playerRef = ref(database, `rooms/${roomCode}/players/${playerId}`);
  // Remove the player
  await remove(playerRef);
};
