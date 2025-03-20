import React from "react";

interface RespawnButtonProps {
  isVisible: boolean;
  onRespawn: () => void;
}

const RespawnButton: React.FC<RespawnButtonProps> = ({ isVisible, onRespawn }) => {
  if (!isVisible) return null;

  return (
    <div className="bg-black bg-opacity-70 p-6 rounded-lg text-center">
      <h2 className="text-red-500 text-2xl font-bold mb-4">You Died!</h2>
      <p className="text-white mb-4">Ready to get back in the game?</p>
      <button
        onClick={onRespawn}
        className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg text-lg font-bold transition-colors transform hover:scale-105"
      >
        Respawn
      </button>
    </div>
  );
};

export default RespawnButton;
