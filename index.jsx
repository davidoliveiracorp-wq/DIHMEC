import React from 'react';
import ReactDOM from 'react-dom/client';
import { motion } from 'framer-motion';
import { ArrowLeft, GitBranch } from 'lucide-react';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 }
};

const svgVariants = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }
  }
};

const App = () => {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      style={{
        minHeight: '100vh',
        padding: '24px',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        background: 'linear-gradient(160deg, #f8fafc 0%, #f0f2f5 100%)'
      }}
    >
      <motion.div variants={itemVariants} style={{ marginBottom: '24px' }}>
        <a
          href="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            color: '#e85d04',
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: '0.9375rem',
            transition: 'opacity 0.2s, transform 0.2s'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.opacity = '0.85';
            e.currentTarget.style.transform = 'translateX(-2px)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.opacity = '1';
            e.currentTarget.style.transform = 'translateX(0)';
          }}
        >
          <ArrowLeft size={18} strokeWidth={2.5} />
          Voltar ao Cadastro
        </a>
      </motion.div>

      <motion.div
        variants={itemVariants}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '24px'
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: 'linear-gradient(135deg, #e85d04 0%, #d45103 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(232, 93, 4, 0.3)'
          }}
        >
          <GitBranch size={22} color="#fff" strokeWidth={2.5} />
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: '1.5rem',
            fontWeight: 700,
            color: '#1a1d24',
            letterSpacing: '-0.02em'
          }}
        >
          Diagrama de Fluxo
        </h1>
      </motion.div>

      <motion.div variants={svgVariants}>
        <svg
          width={800}
          height={600}
          viewBox="0 0 800 600"
          style={{
            width: '100%',
            maxWidth: 800,
            height: 'auto',
            border: '1px solid #e8eaed',
            borderRadius: 16,
            background: '#fff',
            boxShadow: '0 4px 24px rgba(0,0,0,0.06)'
          }}
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
              <polygon points="0 0, 10 3, 0 6" fill="#495057" />
            </marker>
          </defs>

          <rect
            x={100}
            y={100}
            width={200}
            height={100}
            fill="#4A90E2"
            stroke="#2E5C8A"
            strokeWidth={2}
            rx={8}
          />
          <text x={200} y={155} fill="#fff" fontSize={16} fontWeight="bold" textAnchor="middle">
            Início
          </text>

          <circle
            cx={400}
            cy={150}
            r={50}
            fill="#50C878"
            stroke="#2E7D4E"
            strokeWidth={2}
          />
          <text x={400} y={155} fill="#fff" fontSize={14} fontWeight="bold" textAnchor="middle">
            Processo
          </text>

          <ellipse
            cx={600}
            cy={150}
            rx={80}
            ry={50}
            fill="#e85d04"
            stroke="#d45103"
            strokeWidth={2}
          />
          <text x={600} y={155} fill="#fff" fontSize={16} fontWeight="bold" textAnchor="middle">
            Fim
          </text>

          <line
            x1={300}
            y1={150}
            x2={350}
            y2={150}
            stroke="#495057"
            strokeWidth={2}
            markerEnd="url(#arrowhead)"
          />
          <line
            x1={450}
            y1={150}
            x2={520}
            y2={150}
            stroke="#495057"
            strokeWidth={2}
            markerEnd="url(#arrowhead)"
          />

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
            <text x={75} y={45} fill="#fff" fontSize={12} textAnchor="middle">
              Grupo de Elementos
            </text>
          </g>

          <path
            d="M 100 450 Q 200 400, 300 450 T 500 450"
            fill="none"
            stroke="#e85d04"
            strokeWidth={3}
            strokeLinecap="round"
          />
        </svg>
      </motion.div>
    </motion.div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

export default App;
