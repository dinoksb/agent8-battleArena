import React, { useState } from "react";

interface LobbyScreenProps {
  onStartGame: (name: string, roomId?: string) => void;
  initialName: string;
}

const LobbyScreen: React.FC<LobbyScreenProps> = ({ onStartGame, initialName }) => {
  const [playerName, setPlayerName] = useState(initialName);
  const [roomId, setRoomId] = useState("");
  const [isJoining, setIsJoining] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsJoining(true);
    
    // Small delay to show loading state
    setTimeout(() => {
      onStartGame(playerName.trim(), roomId.trim());
      setIsJoining(false);
    }, 300);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4">
      <div className="bg-gray-800 p-8 rounded-lg shadow-lg max-w-md w-full">
        <h1 className="text-3xl font-bold text-center text-white mb-6">Battle Arena</h1>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="playerName" className="block text-sm font-medium text-gray-300 mb-1">
              Player Name
            </label>
            <input
              type="text"
              id="playerName"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="w-full px-4 py-2 bg-gray-700 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your name"
              required
              maxLength={15}
            />
          </div>
          
          <div>
            <label htmlFor="roomId" className="block text-sm font-medium text-gray-300 mb-1">
              Room ID (Optional)
            </label>
            <input
              type="text"
              id="roomId"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="w-full px-4 py-2 bg-gray-700 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Leave empty to create a new room"
            />
            <p className="mt-1 text-xs text-gray-400">
              Enter a room ID to join an existing game, or leave empty to create a new room.
            </p>
          </div>
          
          <div>
            <button
              type="submit"
              disabled={isJoining || !playerName.trim()}
              className={`w-full py-3 px-4 rounded-md text-white font-medium transition-colors ${
                isJoining || !playerName.trim()
                  ? "bg-gray-600 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {isJoining ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Joining...
                </span>
              ) : roomId ? "Join Game" : "Create Game"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LobbyScreen;
