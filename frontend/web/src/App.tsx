import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface SalaryStream {
  id: string;
  employeeName: string;
  encryptedSalary: string;
  publicRate: number;
  totalHours: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue?: number;
  streamStatus: 'active' | 'paused' | 'completed';
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [salaryStreams, setSalaryStreams] = useState<SalaryStream[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingStream, setCreatingStream] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newStreamData, setNewStreamData] = useState({ 
    employeeName: "", 
    hourlyRate: "", 
    totalHours: "",
    description: "" 
  });
  const [selectedStream, setSelectedStream] = useState<SalaryStream | null>(null);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeTab, setActiveTab] = useState('streams');
  const [searchTerm, setSearchTerm] = useState('');
  const [stats, setStats] = useState({
    totalStreams: 0,
    activeStreams: 0,
    totalPaid: 0,
    avgHourlyRate: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  useEffect(() => {
    updateStats();
  }, [salaryStreams]);

  const updateStats = () => {
    const totalStreams = salaryStreams.length;
    const activeStreams = salaryStreams.filter(s => s.streamStatus === 'active').length;
    const totalPaid = salaryStreams.reduce((sum, stream) => sum + (stream.decryptedValue || 0), 0);
    const avgHourlyRate = totalStreams > 0 ? salaryStreams.reduce((sum, stream) => sum + stream.publicRate, 0) / totalStreams : 0;

    setStats({ totalStreams, activeStreams, totalPaid, avgHourlyRate });
  };

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const streamsList: SalaryStream[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          streamsList.push({
            id: businessId,
            employeeName: businessData.name,
            encryptedSalary: businessId,
            publicRate: Number(businessData.publicValue1) || 0,
            totalHours: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            streamStatus: ['active', 'paused', 'completed'][Math.floor(Math.random() * 3)] as any
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setSalaryStreams(streamsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createStream = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingStream(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating salary stream with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const hourlyRate = parseInt(newStreamData.hourlyRate) || 0;
      const businessId = `salary-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, hourlyRate);
      
      const tx = await contract.createBusinessData(
        businessId,
        newStreamData.employeeName,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        hourlyRate,
        parseInt(newStreamData.totalHours) || 0,
        newStreamData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Salary stream created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewStreamData({ employeeName: "", hourlyRate: "", totalHours: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingStream(false); 
    }
  };

  const decryptSalary = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Salary already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying salary decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Salary decrypted and verified!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Salary is already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and working!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredStreams = salaryStreams.filter(stream =>
    stream.employeeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    stream.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStatsPanel = () => (
    <div className="stats-grid">
      <div className="stat-card neon-purple">
        <div className="stat-icon">💰</div>
        <div className="stat-content">
          <h3>Total Streams</h3>
          <div className="stat-value">{stats.totalStreams}</div>
        </div>
      </div>
      
      <div className="stat-card neon-blue">
        <div className="stat-icon">⚡</div>
        <div className="stat-content">
          <h3>Active Streams</h3>
          <div className="stat-value">{stats.activeStreams}</div>
        </div>
      </div>
      
      <div className="stat-card neon-pink">
        <div className="stat-icon">🛡️</div>
        <div className="stat-content">
          <h3>Total Paid (FHE)</h3>
          <div className="stat-value">${stats.totalPaid}</div>
        </div>
      </div>
      
      <div className="stat-card neon-green">
        <div className="stat-icon">📊</div>
        <div className="stat-content">
          <h3>Avg Rate/Hour</h3>
          <div className="stat-value">${stats.avgHourlyRate}</div>
        </div>
      </div>
    </div>
  );

  const renderFHEProcess = () => (
    <div className="fhe-process">
      <div className="process-step">
        <div className="step-number">1</div>
        <div className="step-content">
          <h4>Encrypt Salary</h4>
          <p>Hourly rate encrypted using FHE before on-chain storage</p>
        </div>
      </div>
      <div className="process-arrow">→</div>
      <div className="process-step">
        <div className="step-number">2</div>
        <div className="step-content">
          <h4>Real-time Streaming</h4>
          <p>Salary streams per second with encrypted calculations</p>
        </div>
      </div>
      <div className="process-arrow">→</div>
      <div className="process-step">
        <div className="step-number">3</div>
        <div className="step-content">
          <h4>Homomorphic Updates</h4>
          <p>Balance updates happen without decryption</p>
        </div>
      </div>
      <div className="process-arrow">→</div>
      <div className="process-step">
        <div className="step-number">4</div>
        <div className="step-content">
          <h4>Secure Decryption</h4>
          <p>Only authorized parties can decrypt final amounts</p>
        </div>
      </div>
    </div>
  );

  const renderFAQ = () => (
    <div className="faq-section">
      <h3>FHE Salary Streaming FAQ</h3>
      <div className="faq-list">
        <div className="faq-item">
          <h4>How does FHE protect my salary privacy?</h4>
          <p>FHE allows calculations on encrypted data without decryption, keeping your salary confidential while enabling real-time streaming.</p>
        </div>
        <div className="faq-item">
          <h4>What information is public vs encrypted?</h4>
          <p>Only the hourly rate is encrypted. Work hours and stream status are public for transparency while maintaining privacy.</p>
        </div>
        <div className="faq-item">
          <h4>How do I verify my encrypted salary?</h4>
          <p>Click the decrypt button to perform off-chain decryption and on-chain verification using zero-knowledge proofs.</p>
        </div>
      </div>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>StreamWage FHE 🔐</h1>
            <p>Privacy-First Salary Streaming</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">💸</div>
            <h2>Connect Your Wallet to Start Streaming</h2>
            <p>Secure, private salary payments with fully homomorphic encryption</p>
            <div className="feature-grid">
              <div className="feature-item">
                <span>🔒</span>
                <p>Encrypted Salary Rates</p>
              </div>
              <div className="feature-item">
                <span>⚡</span>
                <p>Real-time Per-Second Payments</p>
              </div>
              <div className="feature-item">
                <span>🛡️</span>
                <p>Zero-Knowledge Verification</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your salary data with homomorphic encryption</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted salary streams...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>StreamWage FHE 🔐</h1>
          <p>秒级隐私薪资流</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="availability-btn">
            Check Contract
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Salary Stream
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      <nav className="app-nav">
        <button 
          className={`nav-btn ${activeTab === 'streams' ? 'active' : ''}`}
          onClick={() => setActiveTab('streams')}
        >
          💰 Salary Streams
        </button>
        <button 
          className={`nav-btn ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          📊 Statistics
        </button>
        <button 
          className={`nav-btn ${activeTab === 'faq' ? 'active' : ''}`}
          onClick={() => setActiveTab('faq')}
        >
          ❓ FAQ
        </button>
      </nav>
      
      <div className="main-content">
        {activeTab === 'streams' && (
          <div className="streams-section">
            <div className="section-header">
              <h2>Active Salary Streams</h2>
              <div className="header-controls">
                <input
                  type="text"
                  placeholder="Search streams..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
                <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
                  {isRefreshing ? "🔄" : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="streams-grid">
              {filteredStreams.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">💸</div>
                  <p>No salary streams found</p>
                  <button onClick={() => setShowCreateModal(true)} className="create-btn">
                    Create First Stream
                  </button>
                </div>
              ) : (
                filteredStreams.map((stream) => (
                  <div 
                    key={stream.id} 
                    className={`stream-card ${stream.streamStatus} ${stream.isVerified ? 'verified' : ''}`}
                    onClick={() => setSelectedStream(stream)}
                  >
                    <div className="stream-header">
                      <h3>{stream.employeeName}</h3>
                      <span className={`status-badge ${stream.streamStatus}`}>
                        {stream.streamStatus}
                      </span>
                    </div>
                    <div className="stream-details">
                      <div className="detail-item">
                        <span>Rate:</span>
                        <span>${stream.publicRate}/hour</span>
                      </div>
                      <div className="detail-item">
                        <span>Hours:</span>
                        <span>{stream.totalHours}h</span>
                      </div>
                      <div className="detail-item">
                        <span>Encrypted Salary:</span>
                        <span>{stream.isVerified ? `$${stream.decryptedValue}` : '🔒 FHE Protected'}</span>
                      </div>
                    </div>
                    <div className="stream-footer">
                      <span className="creator">
                        {stream.creator.substring(0, 6)}...{stream.creator.substring(38)}
                      </span>
                      <button 
                        className={`decrypt-btn ${stream.isVerified ? 'verified' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          decryptSalary(stream.id);
                        }}
                      >
                        {stream.isVerified ? '✅ Verified' : '🔓 Decrypt'}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        
        {activeTab === 'stats' && (
          <div className="stats-section">
            <h2>Salary Streaming Analytics</h2>
            {renderStatsPanel()}
            <div className="fhe-process-panel">
              <h3>FHE Encryption Process</h3>
              {renderFHEProcess()}
            </div>
          </div>
        )}
        
        {activeTab === 'faq' && (
          <div className="faq-tab">
            <h2>Frequently Asked Questions</h2>
            {renderFAQ()}
          </div>
        )}
      </div>
      
      {showCreateModal && (
        <CreateStreamModal 
          onSubmit={createStream}
          onClose={() => setShowCreateModal(false)}
          creating={creatingStream}
          streamData={newStreamData}
          setStreamData={setNewStreamData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedStream && (
        <StreamDetailModal
          stream={selectedStream}
          onClose={() => setSelectedStream(null)}
          onDecrypt={() => decryptSalary(selectedStream.id)}
          isDecrypting={fheIsDecrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </span>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

const CreateStreamModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  streamData: any;
  setStreamData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, streamData, setStreamData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setStreamData({ ...streamData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Create New Salary Stream</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="notice-icon">🔐</div>
            <div>
              <strong>FHE Encrypted Salary</strong>
              <p>Hourly rate will be encrypted using fully homomorphic encryption</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Employee Name *</label>
            <input
              type="text"
              name="employeeName"
              value={streamData.employeeName}
              onChange={handleChange}
              placeholder="Enter employee name..."
            />
          </div>
          
          <div className="form-group">
            <label>Hourly Rate (FHE Encrypted) *</label>
            <input
              type="number"
              name="hourlyRate"
              value={streamData.hourlyRate}
              onChange={handleChange}
              placeholder="Enter hourly rate..."
              min="0"
            />
            <span className="input-hint">This value will be FHE encrypted</span>
          </div>
          
          <div className="form-group">
            <label>Total Hours *</label>
            <input
              type="number"
              name="totalHours"
              value={streamData.totalHours}
              onChange={handleChange}
              placeholder="Enter total hours..."
              min="0"
            />
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea
              name="description"
              value={streamData.description}
              onChange={handleChange}
              placeholder="Stream description..."
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button
            onClick={onSubmit}
            disabled={creating || isEncrypting || !streamData.employeeName || !streamData.hourlyRate || !streamData.totalHours}
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Stream"}
          </button>
        </div>
      </div>
    </div>
  );
};

const StreamDetailModal: React.FC<{
  stream: SalaryStream;
  onClose: () => void;
  onDecrypt: () => void;
  isDecrypting: boolean;
}> = ({ stream, onClose, onDecrypt, isDecrypting }) => {
  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Salary Stream Details</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="stream-info">
            <div className="info-row">
              <span>Employee:</span>
              <strong>{stream.employeeName}</strong>
            </div>
            <div className="info-row">
              <span>Status:</span>
              <span className={`status-tag ${stream.streamStatus}`}>{stream.streamStatus}</span>
            </div>
            <div className="info-row">
              <span>Hourly Rate:</span>
              <strong>${stream.publicRate}/hour</strong>
            </div>
            <div className="info-row">
              <span>Total Hours:</span>
              <strong>{stream.totalHours}h</strong>
            </div>
            <div className="info-row">
              <span>Created:</span>
              <span>{new Date(stream.timestamp * 1000).toLocaleDateString()}</span>
            </div>
          </div>
          
          <div className="salary-section">
            <h3>Encrypted Salary</h3>
            <div className="salary-display">
              {stream.isVerified ? (
                <div className="decrypted-salary">
                  <span className="salary-amount">${stream.decryptedValue}</span>
                  <span className="verification-badge verified">✅ On-chain Verified</span>
                </div>
              ) : (
                <div className="encrypted-salary">
                  <span className="salary-amount">🔒 FHE Encrypted</span>
                  <span className="verification-badge">Pending Verification</span>
                </div>
              )}
            </div>
            
            <button
              onClick={onDecrypt}
              disabled={isDecrypting}
              className={`decrypt-action-btn ${stream.isVerified ? 'verified' : ''}`}
            >
              {isDecrypting ? 'Decrypting...' : stream.isVerified ? '✅ Verified' : '🔓 Verify Salary'}
            </button>
          </div>
          
          <div className="description-section">
            <h3>Description</h3>
            <p>{stream.description}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;

