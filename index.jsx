import React from 'react';
import ReactDOM from 'react-dom/client';

// Diagrama usando SVG nativo (sem dependência lucid-react)
const App = () => {
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Diagrama Lucid React</h1>

      <svg
        width={800}
        height={600}
        viewBox="0 0 800 600"
        style={{ border: '1px solid #ddd', background: '#fafafa' }}
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 10 3, 0 6" fill="#333333" />
          </marker>
        </defs>

        {/* Retângulo principal */}
        <rect
          x={100}
          y={100}
          width={200}
          height={100}
          fill="#4A90E2"
          stroke="#2E5C8A"
          strokeWidth={2}
        />
        <text
          x={200}
          y={155}
          fill="#FFFFFF"
          fontSize={16}
          fontWeight="bold"
          textAnchor="middle"
        >
          Início
        </text>

        {/* Círculo */}
        <circle
          cx={400}
          cy={150}
          r={50}
          fill="#50C878"
          stroke="#2E7D4E"
          strokeWidth={2}
        />
        <text
          x={400}
          y={155}
          fill="#FFFFFF"
          fontSize={14}
          fontWeight="bold"
          textAnchor="middle"
        >
          Processo
        </text>

        {/* Elipse */}
        <ellipse
          cx={600}
          cy={150}
          rx={80}
          ry={50}
          fill="#FF6B6B"
          stroke="#C92A2A"
          strokeWidth={2}
        />
        <text
          x={600}
          y={155}
          fill="#FFFFFF"
          fontSize={16}
          fontWeight="bold"
          textAnchor="middle"
        >
          Fim
        </text>

        {/* Linhas conectando os elementos */}
        <line
          x1={300}
          y1={150}
          x2={350}
          y2={150}
          stroke="#333333"
          strokeWidth={2}
          markerEnd="url(#arrowhead)"
        />
        <line
          x1={450}
          y1={150}
          x2={520}
          y2={150}
          stroke="#333333"
          strokeWidth={2}
          markerEnd="url(#arrowhead)"
        />

        {/* Grupo de elementos */}
        <g transform="translate(200, 300)">
          <rect
            x={0}
            y={0}
            width={150}
            height={80}
            fill="#9B59B6"
            stroke="#6C3483"
            strokeWidth={2}
            rx={10}
          />
          <text
            x={75}
            y={45}
            fill="#FFFFFF"
            fontSize={12}
            textAnchor="middle"
          >
            Grupo de Elementos
          </text>
        </g>

        {/* Path personalizado */}
        <path
          d="M 100 450 Q 200 400, 300 450 T 500 450"
          fill="none"
          stroke="#F39C12"
          strokeWidth={3}
        />
      </svg>
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

export default App;
