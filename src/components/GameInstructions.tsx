import React from "react";

interface GameInstructionsProps {
  className?: string;
}

const GameInstructions: React.FC<GameInstructionsProps> = ({ className }) => {
  return (
    <div className={`bg-black bg-opacity-70 text-white p-3 rounded-md text-center ${className}`}>
      <p className="font-medium">Use arrow keys or WASD to move, SPACE to shoot</p>
    </div>
  );
};

export default GameInstructions;
