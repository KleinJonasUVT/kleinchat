import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, useParams, useNavigate, useLocation } from 'react-router-dom';
import './App.css';
import ChatView from './ChatView';

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

function ChatRoute({ currentModel, onChatUpdate, chatId: propChatId, onDeleteChat, onNewChat }) {
  const { chatId: paramChatId } = useParams();
  const chatId = propChatId !== undefined ? propChatId : (paramChatId || null);
  return <ChatView chatId={chatId} currentModel={currentModel} onChatUpdate={onChatUpdate} onDeleteChat={onDeleteChat} onNewChat={onNewChat} />;
}

function AppContent() {
  const [currentModel, setCurrentModel] = useState('gemma3:1b');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [chats, setChats] = useState([]);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [editingChatId, setEditingChatId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [chatToDelete, setChatToDelete] = useState(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [customInstructions, setCustomInstructions] = useState('');
  const isCreatingChatRef = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Load chats from database
  useEffect(() => {
    loadChats();
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await fetch('http://localhost:5001/api/settings');
      if (response.ok) {
        const settings = await response.json();
        setCustomInstructions(settings.custom_instructions || '');
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const saveSettings = async () => {
    try {
      const response = await fetch('http://localhost:5001/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          custom_instructions: customInstructions,
        }),
      });
      if (response.ok) {
        console.log('Settings saved successfully');
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Error saving settings:', errorData.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openMenuId && !event.target.closest('.chat-item-menu')) {
        setOpenMenuId(null);
      }
    };

    if (openMenuId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openMenuId]);

  // Close search modal on ESC key
  useEffect(() => {
    const handleEsc = (event) => {
      if (event.key === 'Escape' && isSearchModalOpen) {
        setIsSearchModalOpen(false);
        setSearchQuery('');
      }
    };

    if (isSearchModalOpen) {
      document.addEventListener('keydown', handleEsc);
      return () => {
        document.removeEventListener('keydown', handleEsc);
      };
    }
  }, [isSearchModalOpen]);

  // Auto-create new chat when on base route
  useEffect(() => {
    if (location.pathname === '/' && !isCreatingChatRef.current) {
      handleNewChat();
    }
  }, [location.pathname]);

  const loadChats = async () => {
    try {
      const response = await fetch('http://localhost:5001/api/chats');
      if (response.ok) {
        const chatsData = await response.json();
        setChats(chatsData);
      }
    } catch (error) {
      console.error('Error loading chats:', error);
    }
  };

  const confirmDeleteChat = (chatId, e) => {
    if (e) {
      e.stopPropagation(); // Prevent navigation when clicking delete
    }
    
    // Find the chat to check if it's a new/empty chat
    const chat = chats.find(c => c.id === chatId);
    if (!chat) {
      // If chat not found in sidebar, create a minimal chat object
      // This can happen when called from header menu
      const minimalChat = { id: chatId, title: 'Chat', messages: [] };
      setChatToDelete(minimalChat);
      return;
    }
    
    if (chat && (!chat.messages || chat.messages.length === 0)) {
      // Prevent deletion of new/empty chats
      alert('Cannot delete a new chat. Please send a message first.');
      return;
    }
    
    // Show confirmation modal
    setChatToDelete(chat);
    setOpenMenuId(null); // Close menu
  };

  const deleteChat = async () => {
    if (!chatToDelete) return;
    
    const chatId = chatToDelete.id;
    
    try {
      console.log('Deleting chat:', chatId);
      const response = await fetch(`http://localhost:5001/api/chats/${chatId}`, {
        method: 'DELETE',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('Chat deleted successfully:', result);
        
        // Get current chat ID before deleting
        const currentChatId = location.pathname.startsWith('/c/') 
          ? location.pathname.split('/c/')[1] 
          : null;
        
        // Refresh chat list
        await loadChats();
        setChatToDelete(null); // Close modal
        
        // If we deleted the current chat, navigate to a new one
        if (currentChatId === chatId) {
          handleNewChat();
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Error deleting chat:', response.status, errorData.error || 'Unknown error');
        alert(`Failed to delete chat: ${errorData.error || 'Unknown error'}`);
        setChatToDelete(null); // Close modal on error
      }
    } catch (error) {
      console.error('Error deleting chat:', error);
      alert(`Failed to delete chat: ${error.message}`);
      setChatToDelete(null); // Close modal on error
    }
  };

  const startRenaming = (chatId, currentTitle, e) => {
    e.stopPropagation();
    setEditingChatId(chatId);
    setEditingTitle(currentTitle);
    setOpenMenuId(null); // Close menu
  };

  const saveRename = async (chatId) => {
    if (!editingTitle.trim()) {
      setEditingChatId(null);
      return;
    }

    try {
      const response = await fetch(`http://localhost:5001/api/chats/${chatId}`, {
        method: 'PUT',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: editingTitle.trim() }),
      });

      if (response.ok) {
        await loadChats(); // Refresh chat list
        setEditingChatId(null);
        setEditingTitle('');
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Error renaming chat:', errorData.error || 'Unknown error');
        alert(`Failed to rename chat: ${errorData.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error renaming chat:', error);
      alert(`Failed to rename chat: ${error.message}`);
    }
  };

  const cancelRename = () => {
    setEditingChatId(null);
    setEditingTitle('');
  };

  const handleNewChat = async () => {
    // Prevent duplicate calls (e.g., from React StrictMode)
    if (isCreatingChatRef.current) return;
    
    isCreatingChatRef.current = true;
    try {
      const response = await fetch('http://localhost:5001/api/chats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'New Chat',
          model: currentModel,
        }),
      });
      if (response.ok) {
        const newChat = await response.json();
        navigate(`/c/${newChat.id}`);
        loadChats(); // Refresh chat list
      }
    } catch (error) {
      console.error('Error creating chat:', error);
    } finally {
      isCreatingChatRef.current = false;
    }
  };

  const formatDate = (dateString) => {
    const today = new Date();
    const messageDate = new Date(dateString);
    const diffTime = Math.abs(today - messageDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return 'This week';
    return 'Earlier';
  };

  // Fuzzy match function for searching chats
  const fuzzyMatch = (text, query) => {
    if (!query) return true;
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    
    // Simple fuzzy matching: check if all characters in query appear in order in text
    let queryIndex = 0;
    for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
      if (lowerText[i] === lowerQuery[queryIndex]) {
        queryIndex++;
      }
    }
    return queryIndex === lowerQuery.length;
  };

  // Filter chats based on search query (searches title and all message content)
  const filteredChats = searchQuery
    ? chats.filter(chat => {
        // Combine title and all message contents into a single searchable string
        const allText = [
          chat.title,
          ...(chat.messages || []).map(msg => msg.content || '')
        ].join(' ');
        
        return fuzzyMatch(allText, searchQuery);
      })
    : chats;

  // Get current chat ID from URL
  const currentChatId = location.pathname.startsWith('/c/') 
    ? location.pathname.split('/c/')[1] 
    : null;

  // Group chats by date
  const groupedChats = {
    'Today': filteredChats.filter(chat => formatDate(chat.updated_at) === 'Today'),
    'Yesterday': filteredChats.filter(chat => formatDate(chat.updated_at) === 'Yesterday'),
    'This week': filteredChats.filter(chat => formatDate(chat.updated_at) === 'This week'),
    'Earlier': filteredChats.filter(chat => formatDate(chat.updated_at) === 'Earlier'),
  };

  return (
    <div className={`app ${isSidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      {/* Main Content Wrapper */}
      <div className="app-content">
        {/* Sidebar */}
        <div className={`sidebar ${isSidebarOpen ? 'open' : 'closed'}`}>
              {/* Sidebar Header */}
              <div className="sidebar-header">
                <img 
                  src="/images/jk_svg.svg" 
                  alt="JK" 
                  className="sidebar-logo" 
                  onClick={handleNewChat}
                  style={{ cursor: 'pointer' }}
                />
            <button 
              className="sidebar-toggle"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              aria-label="Toggle sidebar"
            >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" data-rtl-flip="" className="icon max-md:hidden">
              <path d="M6.83496 3.99992C6.38353 4.00411 6.01421 4.0122 5.69824 4.03801C5.31232 4.06954 5.03904 4.12266 4.82227 4.20012L4.62207 4.28606C4.18264 4.50996 3.81498 4.85035 3.55859 5.26848L3.45605 5.45207C3.33013 5.69922 3.25006 6.01354 3.20801 6.52824C3.16533 7.05065 3.16504 7.71885 3.16504 8.66301V11.3271C3.16504 12.2712 3.16533 12.9394 3.20801 13.4618C3.25006 13.9766 3.33013 14.2909 3.45605 14.538L3.55859 14.7216C3.81498 15.1397 4.18266 15.4801 4.62207 15.704L4.82227 15.79C5.03904 15.8674 5.31234 15.9205 5.69824 15.9521C6.01398 15.9779 6.383 15.986 6.83398 15.9902L6.83496 3.99992ZM18.165 11.3271C18.165 12.2493 18.1653 12.9811 18.1172 13.5702C18.0745 14.0924 17.9916 14.5472 17.8125 14.9648L17.7295 15.1415C17.394 15.8 16.8834 16.3511 16.2568 16.7353L15.9814 16.8896C15.5157 17.1268 15.0069 17.2285 14.4102 17.2773C13.821 17.3254 13.0893 17.3251 12.167 17.3251H7.83301C6.91071 17.3251 6.17898 17.3254 5.58984 17.2773C5.06757 17.2346 4.61294 17.1508 4.19531 16.9716L4.01855 16.8896C3.36014 16.5541 2.80898 16.0434 2.4248 15.4169L2.27051 15.1415C2.03328 14.6758 1.93158 14.167 1.88281 13.5702C1.83468 12.9811 1.83496 12.2493 1.83496 11.3271V8.66301C1.83496 7.74072 1.83468 7.00898 1.88281 6.41985C1.93157 5.82309 2.03329 5.31432 2.27051 4.84856L2.4248 4.57317C2.80898 3.94666 3.36012 3.436 4.01855 3.10051L4.19531 3.0175C4.61285 2.83843 5.06771 2.75548 5.58984 2.71281C6.17898 2.66468 6.91071 2.66496 7.83301 2.66496H12.167C13.0893 2.66496 13.821 2.66468 14.4102 2.71281C15.0069 2.76157 15.5157 2.86329 15.9814 3.10051L16.2568 3.25481C16.8833 3.63898 17.394 4.19012 17.7295 4.84856L17.8125 5.02531C17.9916 5.44285 18.0745 5.89771 18.1172 6.41985C18.1653 7.00898 18.165 7.74072 18.165 8.66301V11.3271ZM8.16406 15.995H12.167C13.1112 15.995 13.7794 15.9947 14.3018 15.9521C14.8164 15.91 15.1308 15.8299 15.3779 15.704L15.5615 15.6015C15.9797 15.3451 16.32 14.9774 16.5439 14.538L16.6299 14.3378C16.7074 14.121 16.7605 13.8478 16.792 13.4618C16.8347 12.9394 16.835 12.2712 16.835 11.3271V8.66301C16.835 7.71885 16.8347 7.05065 16.792 6.52824C16.7605 6.14232 16.7073 5.86904 16.6299 5.65227L16.5439 5.45207C16.32 5.01264 15.9796 4.64498 15.5615 4.3886L15.3779 4.28606C15.1308 4.16013 14.8165 4.08006 14.3018 4.03801C13.7794 3.99533 13.1112 3.99504 12.167 3.99504H8.16406C8.16407 3.99667 8.16504 3.99829 8.16504 3.99992L8.16406 15.995Z"></path>
            </svg>
          </button>
          </div>
          <button className="new-chat-btn" onClick={handleNewChat}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="icon" aria-hidden="true">
              <path d="M2.6687 11.333V8.66699C2.6687 7.74455 2.66841 7.01205 2.71655 6.42285C2.76533 5.82612 2.86699 5.31731 3.10425 4.85156L3.25854 4.57617C3.64272 3.94975 4.19392 3.43995 4.85229 3.10449L5.02905 3.02149C5.44666 2.84233 5.90133 2.75849 6.42358 2.71582C7.01272 2.66769 7.74445 2.66797 8.66675 2.66797H9.16675C9.53393 2.66797 9.83165 2.96586 9.83179 3.33301C9.83179 3.70028 9.53402 3.99805 9.16675 3.99805H8.66675C7.7226 3.99805 7.05438 3.99834 6.53198 4.04102C6.14611 4.07254 5.87277 4.12568 5.65601 4.20313L5.45581 4.28906C5.01645 4.51293 4.64872 4.85345 4.39233 5.27149L4.28979 5.45508C4.16388 5.7022 4.08381 6.01663 4.04175 6.53125C3.99906 7.05373 3.99878 7.7226 3.99878 8.66699V11.333C3.99878 12.2774 3.99906 12.9463 4.04175 13.4688C4.08381 13.9833 4.16389 14.2978 4.28979 14.5449L4.39233 14.7285C4.64871 15.1465 5.01648 15.4871 5.45581 15.7109L5.65601 15.7969C5.87276 15.8743 6.14614 15.9265 6.53198 15.958C7.05439 16.0007 7.72256 16.002 8.66675 16.002H11.3337C12.2779 16.002 12.9461 16.0007 13.4685 15.958C13.9829 15.916 14.2976 15.8367 14.5447 15.7109L14.7292 15.6074C15.147 15.3511 15.4879 14.9841 15.7117 14.5449L15.7976 14.3447C15.8751 14.128 15.9272 13.8546 15.9587 13.4688C16.0014 12.9463 16.0017 12.2774 16.0017 11.333V10.833C16.0018 10.466 16.2997 10.1681 16.6667 10.168C17.0339 10.168 17.3316 10.4659 17.3318 10.833V11.333C17.3318 12.2555 17.3331 12.9879 17.2849 13.5771C17.2422 14.0993 17.1584 14.5541 16.9792 14.9717L16.8962 15.1484C16.5609 15.8066 16.0507 16.3571 15.4246 16.7412L15.1492 16.8955C14.6833 17.1329 14.1739 17.2354 13.5769 17.2842C12.9878 17.3323 12.256 17.332 11.3337 17.332H8.66675C7.74446 17.332 7.01271 17.3323 6.42358 17.2842C5.90135 17.2415 5.44665 17.1577 5.02905 16.9785L4.85229 16.8955C4.19396 16.5601 3.64271 16.0502 3.25854 15.4238L3.10425 15.1484C2.86697 14.6827 2.76534 14.1739 2.71655 13.5771C2.66841 12.9879 2.6687 12.2555 2.6687 11.333ZM13.4646 3.11328C14.4201 2.334 15.8288 2.38969 16.7195 3.28027L16.8865 3.46485C17.6141 4.35685 17.6143 5.64423 16.8865 6.53613L16.7195 6.7207L11.6726 11.7686C11.1373 12.3039 10.4624 12.6746 9.72827 12.8408L9.41089 12.8994L7.59351 13.1582C7.38637 13.1877 7.17701 13.1187 7.02905 12.9707C6.88112 12.8227 6.81199 12.6134 6.84155 12.4063L7.10132 10.5898L7.15991 10.2715C7.3262 9.53749 7.69692 8.86241 8.23218 8.32715L13.2791 3.28027L13.4646 3.11328ZM15.7791 4.2207C15.3753 3.81702 14.7366 3.79124 14.3035 4.14453L14.2195 4.2207L9.17261 9.26856C8.81541 9.62578 8.56774 10.0756 8.45679 10.5654L8.41772 10.7773L8.28296 11.7158L9.22241 11.582L9.43433 11.543C9.92426 11.432 10.3749 11.1844 10.7322 10.8271L15.7791 5.78027L15.8552 5.69629C16.185 5.29194 16.1852 4.708 15.8552 4.30371L15.7791 4.2207Z"></path>
            </svg>
            <span>New Chat</span>
          </button>
          
          {/* Search Button */}
          <button 
            className="chat-search-btn" 
            onClick={() => setIsSearchModalOpen(true)}
            aria-label="Search chats"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="icon" aria-hidden="true">
              <path d="M14.0857 8.74999C14.0857 5.80355 11.6972 3.41503 8.75073 3.41503C5.80429 3.41503 3.41577 5.80355 3.41577 8.74999C3.41577 11.6964 5.80429 14.085 8.75073 14.085C11.6972 14.085 14.0857 11.6964 14.0857 8.74999ZM15.4158 8.74999C15.4158 10.3539 14.848 11.8245 13.9041 12.9746L13.9705 13.0303L16.9705 16.0303L17.0564 16.1338C17.2269 16.3919 17.1977 16.7434 16.9705 16.9707C16.7432 17.1975 16.3925 17.226 16.1345 17.0557L16.03 16.9707L13.03 13.9707L12.9753 13.9033C11.8253 14.8472 10.3547 15.415 8.75073 15.415C5.06975 15.415 2.08569 12.431 2.08569 8.74999C2.08569 5.06901 5.06975 2.08495 8.75073 2.08495C12.4317 2.08495 15.4158 5.06901 15.4158 8.74999Z"></path>
            </svg>
            <span>Search chats</span>
          </button>
        
        <div className="chat-history-wrapper">
          <div className="chat-history">
            {Object.entries(groupedChats).map(([sectionLabel, sectionChats]) => 
              sectionChats.length > 0 && (
                <div key={sectionLabel} className="history-section">
                  <div className="section-label">{sectionLabel}</div>
                  {sectionChats.map((chat) => (
                    <div 
                      key={chat.id} 
                      className={`chat-item ${currentChatId === chat.id ? 'active' : ''}`}
                      onClick={() => {
                        if (editingChatId !== chat.id) {
                          navigate(`/c/${chat.id}`);
                          setOpenMenuId(null);
                        }
                      }}
                    >
                      {editingChatId === chat.id ? (
                        <input
                          className="chat-item-rename-input"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onBlur={() => saveRename(chat.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              saveRename(chat.id);
                            } else if (e.key === 'Escape') {
                              cancelRename();
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          autoFocus
                        />
                      ) : (
                        <>
                          <span className="chat-item-title">{chat.title}</span>
                          <div className="chat-item-menu">
                            <button
                              className="chat-item-menu-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId(openMenuId === chat.id ? null : chat.id);
                              }}
                              aria-label="Chat options"
                            >
                              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="icon">
                                <path d="M15.498 8.50159C16.3254 8.50159 16.9959 9.17228 16.9961 9.99963C16.9961 10.8271 16.3256 11.4987 15.498 11.4987C14.6705 11.4987 14 10.8271 14 9.99963C14.0002 9.17228 14.6706 8.50159 15.498 8.50159Z"></path>
                                <path d="M4.49805 8.50159C5.32544 8.50159 5.99689 9.17228 5.99707 9.99963C5.99707 10.8271 5.32555 11.4987 4.49805 11.4987C3.67069 11.4985 3 10.827 3 9.99963C3.00018 9.17239 3.6708 8.50176 4.49805 8.50159Z"></path>
                                <path d="M10.0003 8.50159C10.8276 8.50176 11.4982 9.17239 11.4984 9.99963C11.4984 10.827 10.8277 11.4985 10.0003 11.4987C9.17283 11.4987 8.50131 10.8271 8.50131 9.99963C8.50149 9.17228 9.17294 8.50159 10.0003 8.50159Z"></path>
                              </svg>
                            </button>
                            {openMenuId === chat.id && (
                              <div className="chat-item-menu-dropdown">
                                <button
                                  className="chat-item-menu-rename"
                                  onClick={(e) => startRenaming(chat.id, chat.title, e)}
                                  aria-label="Rename chat"
                                >
                                  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="icon h-6 w-6">
                                    <path d="M11.3312 3.56837C12.7488 2.28756 14.9376 2.33009 16.3038 3.6963L16.4318 3.83106C17.6712 5.20294 17.6712 7.29708 16.4318 8.66895L16.3038 8.80372L10.0118 15.0947C9.68833 15.4182 9.45378 15.6553 9.22179 15.8457L8.98742 16.0225C8.78227 16.1626 8.56423 16.2832 8.33703 16.3828L8.10753 16.4756C7.92576 16.5422 7.73836 16.5902 7.5216 16.6348L6.75695 16.7705L4.36339 17.169C4.22053 17.1928 4.06908 17.2188 3.94054 17.2285C3.84177 17.236 3.70827 17.2386 3.56261 17.2031L3.41417 17.1543C3.19115 17.0586 3.00741 16.8908 2.89171 16.6797L2.84581 16.5859C2.75951 16.3846 2.76168 16.1912 2.7716 16.0596C2.7813 15.931 2.80736 15.7796 2.83117 15.6367L3.2296 13.2432L3.36437 12.4785C3.40893 12.2616 3.45789 12.0745 3.52453 11.8926L3.6173 11.6621C3.71685 11.4352 3.83766 11.2176 3.97765 11.0127L4.15343 10.7783C4.34386 10.5462 4.58164 10.312 4.90538 9.98829L11.1964 3.6963L11.3312 3.56837ZM5.84581 10.9287C5.49664 11.2779 5.31252 11.4634 5.18663 11.6162L5.07531 11.7627C4.98188 11.8995 4.90151 12.0448 4.83507 12.1963L4.77355 12.3506C4.73321 12.4607 4.70242 12.5761 4.66808 12.7451L4.54113 13.4619L4.14269 15.8555L4.14171 15.8574H4.14464L6.5382 15.458L7.25499 15.332C7.424 15.2977 7.5394 15.2669 7.64953 15.2266L7.80285 15.165C7.95455 15.0986 8.09947 15.0174 8.23644 14.9238L8.3839 14.8135C8.53668 14.6876 8.72225 14.5035 9.0714 14.1543L14.0587 9.16602L10.8331 5.94044L5.84581 10.9287ZM15.3634 4.63673C14.5281 3.80141 13.2057 3.74938 12.3097 4.48048L12.1368 4.63673L11.7735 5.00001L15.0001 8.22559L15.3634 7.86329L15.5196 7.68946C16.2015 6.85326 16.2015 5.64676 15.5196 4.81056L15.3634 4.63673Z"></path>
                                  </svg>
                                  <span>Rename</span>
                                </button>
                                {chat.messages && chat.messages.length > 0 && (
                                  <button
                                    className="chat-item-menu-delete"
                                    onClick={(e) => confirmDeleteChat(chat.id, e)}
                                    aria-label="Delete chat"
                                  >
                                    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="icon" aria-hidden="true">
                                      <path d="M10.6299 1.33496C12.0335 1.33496 13.2695 2.25996 13.666 3.60645L13.8809 4.33496H17L17.1338 4.34863C17.4369 4.41057 17.665 4.67858 17.665 5C17.665 5.32142 17.4369 5.58943 17.1338 5.65137L17 5.66504H16.6543L15.8574 14.9912C15.7177 16.629 14.3478 17.8877 12.7041 17.8877H7.2959C5.75502 17.8877 4.45439 16.7815 4.18262 15.2939L4.14258 14.9912L3.34668 5.66504H3C2.63273 5.66504 2.33496 5.36727 2.33496 5C2.33496 4.63273 2.63273 4.33496 3 4.33496H6.11914L6.33398 3.60645L6.41797 3.3584C6.88565 2.14747 8.05427 1.33496 9.37012 1.33496H10.6299ZM5.46777 14.8779L5.49121 15.0537C5.64881 15.9161 6.40256 16.5576 7.2959 16.5576H12.7041C13.6571 16.5576 14.4512 15.8275 14.5322 14.8779L15.3193 5.66504H4.68164L5.46777 14.8779ZM7.66797 12.8271V8.66016C7.66797 8.29299 7.96588 7.99528 8.33301 7.99512C8.70028 7.99512 8.99805 8.29289 8.99805 8.66016V12.8271C8.99779 13.1942 8.70012 13.4912 8.33301 13.4912C7.96604 13.491 7.66823 13.1941 7.66797 12.8271ZM11.002 12.8271V8.66016C11.002 8.29289 11.2997 7.99512 11.667 7.99512C12.0341 7.9953 12.332 8.293 12.332 8.66016V12.8271C12.3318 13.1941 12.0339 13.491 11.667 13.4912C11.2999 13.4912 11.0022 13.1942 11.002 12.8271ZM9.37012 2.66504C8.60726 2.66504 7.92938 3.13589 7.6582 3.83789L7.60938 3.98145L7.50586 4.33496H12.4941L12.3906 3.98145C12.1607 3.20084 11.4437 2.66504 10.6299 2.66504H9.37012Z"></path>
                                    </svg>
                                    <span>Delete</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
        
        {/* Settings Button */}
        <button 
          className="sidebar-settings-btn" 
          onClick={() => setIsSettingsModalOpen(true)}
          aria-label="Settings"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="icon" aria-hidden="true">
            <path d="M10.3227 1.62663C11.1514 1.62663 11.9182 2.066 12.3373 2.78092L13.1586 4.18131L13.2123 4.25065C13.2735 4.31105 13.3565 4.34658 13.4448 4.34733L15.06 4.36002L15.2143 4.36686C15.9825 4.4239 16.6774 4.85747 17.0649 5.53092L17.393 6.10221L17.4662 6.23795C17.7814 6.88041 17.7842 7.63306 17.4741 8.27799L17.4028 8.41373L16.6 9.83561C16.5426 9.93768 16.5425 10.0627 16.6 10.1647L17.4028 11.5856L17.4741 11.7223C17.7841 12.3673 17.7815 13.1199 17.4662 13.7624L17.393 13.8981L17.0649 14.4694C16.6774 15.1427 15.9824 15.5764 15.2143 15.6335L15.06 15.6393L13.4448 15.653C13.3565 15.6537 13.2736 15.6892 13.2123 15.7497L13.1586 15.818L12.3373 17.2194C11.9182 17.9342 11.1513 18.3737 10.3227 18.3737H9.6762C8.8995 18.3735 8.17705 17.9874 7.74456 17.3503L7.66253 17.2194L6.84124 15.818C6.79652 15.7418 6.72408 15.6876 6.64105 15.6647L6.55511 15.653L4.93987 15.6393C4.16288 15.633 3.44339 15.2413 3.01605 14.6003L2.93499 14.4694L2.60687 13.8981C2.19555 13.1831 2.1916 12.3039 2.5971 11.5856L3.39886 10.1647L3.43206 10.0846C3.44649 10.0293 3.44644 9.97102 3.43206 9.91569L3.39886 9.83561L2.5971 8.41373C2.19175 7.6955 2.19562 6.8171 2.60687 6.10221L2.93499 5.53092L3.01605 5.40006C3.44337 4.75894 4.1628 4.36636 4.93987 4.36002L6.55511 4.34733L6.64105 4.33561C6.72418 4.31275 6.79651 4.25762 6.84124 4.18131L7.66253 2.78092L7.74456 2.65006C8.17704 2.01277 8.89941 1.62678 9.6762 1.62663H10.3227ZM9.6762 2.9567C9.36439 2.95685 9.07299 3.10138 8.88421 3.34342L8.80999 3.45377L7.9887 4.85416C7.72933 5.29669 7.28288 5.59093 6.78265 5.6608L6.56585 5.67741L4.95062 5.6901C4.63868 5.69265 4.34845 5.84001 4.16155 6.08366L4.08733 6.19401L3.75921 6.7653C3.58227 7.073 3.5808 7.45131 3.7553 7.76041L4.55706 9.18131L4.65179 9.37663C4.81309 9.77605 4.81294 10.2232 4.65179 10.6227L4.55706 10.819L3.7553 12.2399C3.58083 12.549 3.5822 12.9273 3.75921 13.235L4.08733 13.8053L4.16155 13.9157C4.34844 14.1596 4.6385 14.3067 4.95062 14.3092L6.56585 14.3229L6.78265 14.3385C7.28292 14.4084 7.72931 14.7036 7.9887 15.1462L8.80999 16.5465L8.88421 16.6559C9.07298 16.8982 9.36422 17.0435 9.6762 17.0436H10.3227C10.6793 17.0436 11.0095 16.8542 11.1899 16.5465L12.0112 15.1462L12.1332 14.9655C12.4432 14.5668 12.9212 14.3271 13.434 14.3229L15.0492 14.3092L15.1811 14.2995C15.4854 14.2567 15.7569 14.076 15.9125 13.8053L16.2407 13.235L16.2983 13.1169C16.3983 12.8745 16.3999 12.6023 16.3022 12.359L16.2446 12.2399L15.4418 10.819C15.1551 10.311 15.1551 9.6893 15.4418 9.18131L16.2446 7.76041L16.3022 7.64127C16.4 7.39806 16.3982 7.12584 16.2983 6.88346L16.2407 6.7653L15.9125 6.19401C15.7568 5.92338 15.4855 5.74264 15.1811 5.69987L15.0492 5.6901L13.434 5.67741C12.9212 5.67322 12.4432 5.43341 12.1332 5.03483L12.0112 4.85416L11.1899 3.45377C11.0095 3.14604 10.6794 2.9567 10.3227 2.9567H9.6762ZM11.5854 9.99967C11.5852 9.12461 10.8755 8.41497 10.0004 8.41471C9.12516 8.41471 8.41466 9.12445 8.41448 9.99967C8.41448 10.875 9.12505 11.5846 10.0004 11.5846C10.8756 11.5844 11.5854 10.8749 11.5854 9.99967ZM12.9145 9.99967C12.9145 11.6094 11.6101 12.9145 10.0004 12.9147C8.39051 12.9147 7.08538 11.6096 7.08538 9.99967C7.08556 8.38991 8.39062 7.08463 10.0004 7.08463C11.61 7.08489 12.9143 8.39007 12.9145 9.99967Z"></path>
          </svg>
          <span>Settings</span>
        </button>
        </div>

        {/* Main Chat Area */}
          <Routes>
            <Route path="/c/:chatId" element={<ChatRoute currentModel={currentModel} onChatUpdate={loadChats} onDeleteChat={confirmDeleteChat} onNewChat={handleNewChat} />} />
            <Route path="/" element={null} />
          </Routes>
      </div>
      
      {/* Search Modal */}
      {isSearchModalOpen && (
        <div className="search-modal-overlay" onClick={() => {
          setIsSearchModalOpen(false);
          setSearchQuery('');
        }}>
          <div className="search-modal" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header with Search */}
            <div className="search-modal-header">
              <div className="search-modal-input-wrapper">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="icon" aria-hidden="true">
                  <path d="M14.0857 8.74999C14.0857 5.80355 11.6972 3.41503 8.75073 3.41503C5.80429 3.41503 3.41577 5.80355 3.41577 8.74999C3.41577 11.6964 5.80429 14.085 8.75073 14.085C11.6972 14.085 14.0857 11.6964 14.0857 8.74999ZM15.4158 8.74999C15.4158 10.3539 14.848 11.8245 13.9041 12.9746L13.9705 13.0303L16.9705 16.0303L17.0564 16.1338C17.2269 16.3919 17.1977 16.7434 16.9705 16.9707C16.7432 17.1975 16.3925 17.226 16.1345 17.0557L16.03 16.9707L13.03 13.9707L12.9753 13.9033C11.8253 14.8472 10.3547 15.415 8.75073 15.415C5.06975 15.415 2.08569 12.431 2.08569 8.74999C2.08569 5.06901 5.06975 2.08495 8.75073 2.08495C12.4317 2.08495 15.4158 5.06901 15.4158 8.74999Z"></path>
                </svg>
                <input
                  type="text"
                  className="search-modal-input"
                  placeholder="Search chats..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
              </div>
              <button 
                className="search-modal-close"
                onClick={() => {
                  setIsSearchModalOpen(false);
                  setSearchQuery('');
                }}
                aria-label="Close search"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="icon">
                  <path d="M10 8.58579L15.2929 3.29289C15.6834 2.90237 16.3166 2.90237 16.7071 3.29289C17.0976 3.68342 17.0976 4.31658 16.7071 4.70711L11.4142 10L16.7071 15.2929C17.0976 15.6834 17.0976 16.3166 16.7071 16.7071C16.3166 17.0976 15.6834 17.0976 15.2929 16.7071L10 11.4142L4.70711 16.7071C4.31658 17.0976 3.68342 17.0976 3.29289 16.7071C2.90237 16.3166 2.90237 15.6834 3.29289 15.2929L8.58579 10L3.29289 4.70711C2.90237 4.31658 2.90237 3.68342 3.29289 3.29289C3.68342 2.90237 4.31658 2.90237 4.70711 3.29289L10 8.58579Z"></path>
                </svg>
              </button>
            </div>
            
            {/* Modal Content */}
            <div className="search-modal-content">
              {/* New Chat Option */}
              <div 
                className="search-modal-new-chat"
                onClick={() => {
                  handleNewChat();
                  setIsSearchModalOpen(false);
                  setSearchQuery('');
                }}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="icon" aria-hidden="true">
                  <path d="M2.6687 11.333V8.66699C2.6687 7.74455 2.66841 7.01205 2.71655 6.42285C2.76533 5.82612 2.86699 5.31731 3.10425 4.85156L3.25854 4.57617C3.64272 3.94975 4.19392 3.43995 4.85229 3.10449L5.02905 3.02149C5.44666 2.84233 5.90133 2.75849 6.42358 2.71582C7.01272 2.66769 7.74445 2.66797 8.66675 2.66797H9.16675C9.53393 2.66797 9.83165 2.96586 9.83179 3.33301C9.83179 3.70028 9.53402 3.99805 9.16675 3.99805H8.66675C7.7226 3.99805 7.05438 3.99834 6.53198 4.04102C6.14611 4.07254 5.87277 4.12568 5.65601 4.20313L5.45581 4.28906C5.01645 4.51293 4.64872 4.85345 4.39233 5.27149L4.28979 5.45508C4.16388 5.7022 4.08381 6.01663 4.04175 6.53125C3.99906 7.05373 3.99878 7.7226 3.99878 8.66699V11.333C3.99878 12.2774 3.99906 12.9463 4.04175 13.4688C4.08381 13.9833 4.16389 14.2978 4.28979 14.5449L4.39233 14.7285C4.64871 15.1465 5.01648 15.4871 5.45581 15.7109L5.65601 15.7969C5.87276 15.8743 6.14614 15.9265 6.53198 15.958C7.05439 16.0007 7.72256 16.002 8.66675 16.002H11.3337C12.2779 16.002 12.9461 16.0007 13.4685 15.958C13.9829 15.916 14.2976 15.8367 14.5447 15.7109L14.7292 15.6074C15.147 15.3511 15.4879 14.9841 15.7117 14.5449L15.7976 14.3447C15.8751 14.128 15.9272 13.8546 15.9587 13.4688C16.0014 12.9463 16.0017 12.2774 16.0017 11.333V10.833C16.0018 10.466 16.2997 10.1681 16.6667 10.168C17.0339 10.168 17.3316 10.4659 17.3318 10.833V11.333C17.3318 12.2555 17.3331 12.9879 17.2849 13.5771C17.2422 14.0993 17.1584 14.5541 16.9792 14.9717L16.8962 15.1484C16.5609 15.8066 16.0507 16.3571 15.4246 16.7412L15.1492 16.8955C14.6833 17.1329 14.1739 17.2354 13.5769 17.2842C12.9878 17.3323 12.256 17.332 11.3337 17.332H8.66675C7.74446 17.332 7.01271 17.3323 6.42358 17.2842C5.90135 17.2415 5.44665 17.1577 5.02905 16.9785L4.85229 16.8955C4.19396 16.5601 3.64271 16.0502 3.25854 15.4238L3.10425 15.1484C2.86697 14.6827 2.76534 14.1739 2.71655 13.5771C2.66841 12.9879 2.6687 12.2555 2.6687 11.333ZM13.4646 3.11328C14.4201 2.334 15.8288 2.38969 16.7195 3.28027L16.8865 3.46485C17.6141 4.35685 17.6143 5.64423 16.8865 6.53613L16.7195 6.7207L11.6726 11.7686C11.1373 12.3039 10.4624 12.6746 9.72827 12.8408L9.41089 12.8994L7.59351 13.1582C7.38637 13.1877 7.17701 13.1187 7.02905 12.9707C6.88112 12.8227 6.81199 12.6134 6.84155 12.4063L7.10132 10.5898L7.15991 10.2715C7.3262 9.53749 7.69692 8.86241 8.23218 8.32715L13.2791 3.28027L13.4646 3.11328ZM15.7791 4.2207C15.3753 3.81702 14.7366 3.79124 14.3035 4.14453L14.2195 4.2207L9.17261 9.26856C8.81541 9.62578 8.56774 10.0756 8.45679 10.5654L8.41772 10.7773L8.28296 11.7158L9.22241 11.582L9.43433 11.543C9.92426 11.432 10.3749 11.1844 10.7322 10.8271L15.7791 5.78027L15.8552 5.69629C16.185 5.29194 16.1852 4.708 15.8552 4.30371L15.7791 4.2207Z"></path>
                </svg>
                <span>New chat</span>
              </div>
              
              {/* Filtered Chats */}
              {Object.entries(groupedChats).map(([sectionLabel, sectionChats]) => 
                sectionChats.length > 0 && (
                  <div key={sectionLabel} className="search-modal-section">
                    <div className="search-modal-section-label">{sectionLabel}</div>
                    {sectionChats.map((chat) => (
                      <div 
                        key={chat.id} 
                        className="search-modal-chat-item"
                        onClick={() => {
                          navigate(`/c/${chat.id}`);
                          setIsSearchModalOpen(false);
                          setSearchQuery('');
                        }}
                      >
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" data-rtl-flip="" className="icon" aria-hidden="true">
                          <path d="M16.835 9.99968C16.8348 6.49038 13.8111 3.58171 10 3.58171C6.18893 3.58171 3.16523 6.49038 3.16504 9.99968C3.16504 11.4535 3.67943 12.7965 4.55273 13.8766C4.67524 14.0281 4.72534 14.2262 4.68945 14.4176C4.59391 14.9254 4.45927 15.4197 4.30469 15.904C4.93198 15.8203 5.5368 15.6959 6.12793 15.528L6.25391 15.5055C6.38088 15.4949 6.5091 15.5208 6.62305 15.5817C7.61731 16.1135 8.76917 16.4186 10 16.4186C13.8112 16.4186 16.835 13.5091 16.835 9.99968ZM18.165 9.99968C18.165 14.3143 14.4731 17.7487 10 17.7487C8.64395 17.7487 7.36288 17.4332 6.23438 16.8757C5.31485 17.118 4.36919 17.2694 3.37402 17.3307C3.14827 17.3446 2.93067 17.2426 2.79688 17.0602C2.66303 16.8778 2.63177 16.6396 2.71289 16.4284L2.91992 15.863C3.08238 15.3953 3.21908 14.9297 3.32227 14.4606C2.38719 13.2019 1.83496 11.6626 1.83496 9.99968C1.83515 5.68525 5.52703 2.25163 10 2.25163C14.473 2.25163 18.1649 5.68525 18.165 9.99968Z"></path>
                        </svg>
                        <span>{chat.title}</span>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
      
        {/* Delete Confirmation Modal */}
        {chatToDelete && (
          <div className="delete-modal-overlay" onClick={() => setChatToDelete(null)}>
            <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
              <div className="delete-modal-title">Delete chat?</div>
              <div className="delete-modal-message">
                This will delete <strong>{chatToDelete.title}</strong>.
              </div>
              <div className="delete-modal-footer">
                <button 
                  className="delete-modal-cancel"
                  onClick={() => setChatToDelete(null)}
                >
                  Cancel
                </button>
                <button 
                  className="delete-modal-confirm"
                  onClick={deleteChat}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Settings Modal */}
        {isSettingsModalOpen && (
          <div className="settings-modal-overlay" onClick={() => setIsSettingsModalOpen(false)}>
            <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
              <div className="settings-modal-header">
                <h2 className="settings-modal-title">Settings</h2>
                <button 
                  className="settings-modal-close"
                  onClick={() => setIsSettingsModalOpen(false)}
                  aria-label="Close settings"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="icon">
                    <path d="M10 8.58579L15.2929 3.29289C15.6834 2.90237 16.3166 2.90237 16.7071 3.29289C17.0976 3.68342 17.0976 4.31658 16.7071 4.70711L11.4142 10L16.7071 15.2929C17.0976 15.6834 17.0976 16.3166 16.7071 16.7071C16.3166 17.0976 15.6834 17.0976 15.2929 16.7071L10 11.4142L4.70711 16.7071C4.31658 17.0976 3.68342 17.0976 3.29289 16.7071C2.90237 16.3166 2.90237 15.6834 3.29289 15.2929L8.58579 10L3.29289 4.70711C2.90237 4.31658 2.90237 3.68342 3.29289 3.29289C3.68342 2.90237 4.31658 2.90237 4.70711 3.29289L10 8.58579Z"></path>
                  </svg>
                </button>
              </div>
              
              <div className="settings-modal-content">
                <div className="settings-tabs">
                  <button className="settings-tab active">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="icon">
                      <path d="M10.3227 1.62663C11.1514 1.62663 11.9182 2.066 12.3373 2.78092L13.1586 4.18131L13.2123 4.25065C13.2735 4.31105 13.3565 4.34658 13.4448 4.34733L15.06 4.36002L15.2143 4.36686C15.9825 4.4239 16.6774 4.85747 17.0649 5.53092L17.393 6.10221L17.4662 6.23795C17.7814 6.88041 17.7842 7.63306 17.4741 8.27799L17.4028 8.41373L16.6 9.83561C16.5426 9.93768 16.5425 10.0627 16.6 10.1647L17.4028 11.5856L17.4741 11.7223C17.7841 12.3673 17.7815 13.1199 17.4662 13.7624L17.393 13.8981L17.0649 14.4694C16.6774 15.1427 15.9824 15.5764 15.2143 15.6335L15.06 15.6393L13.4448 15.653C13.3565 15.6537 13.2736 15.6892 13.2123 15.7497L13.1586 15.818L12.3373 17.2194C11.9182 17.9342 11.1513 18.3737 10.3227 18.3737H9.6762C8.8995 18.3735 8.17705 17.9874 7.74456 17.3503L7.66253 17.2194L6.84124 15.818C6.79652 15.7418 6.72408 15.6876 6.64105 15.6647L6.55511 15.653L4.93987 15.6393C4.16288 15.633 3.44339 15.2413 3.01605 14.6003L2.93499 14.4694L2.60687 13.8981C2.19555 13.1831 2.1916 12.3039 2.5971 11.5856L3.39886 10.1647L3.43206 10.0846C3.44649 10.0293 3.44644 9.97102 3.43206 9.91569L3.39886 9.83561L2.5971 8.41373C2.19175 7.6955 2.19562 6.8171 2.60687 6.10221L2.93499 5.53092L3.01605 5.40006C3.44337 4.75894 4.1628 4.36636 4.93987 4.36002L6.55511 4.34733L6.64105 4.33561C6.72418 4.31275 6.79651 4.25762 6.84124 4.18131L7.66253 2.78092L7.74456 2.65006C8.17704 2.01277 8.89941 1.62678 9.6762 1.62663H10.3227ZM9.6762 2.9567C9.36439 2.95685 9.07299 3.10138 8.88421 3.34342L8.80999 3.45377L7.9887 4.85416C7.72933 5.29669 7.28288 5.59093 6.78265 5.6608L6.56585 5.67741L4.95062 5.6901C4.63868 5.69265 4.34845 5.84001 4.16155 6.08366L4.08733 6.19401L3.75921 6.7653C3.58227 7.073 3.5808 7.45131 3.7553 7.76041L4.55706 9.18131L4.65179 9.37663C4.81309 9.77605 4.81294 10.2232 4.65179 10.6227L4.55706 10.819L3.7553 12.2399C3.58083 12.549 3.5822 12.9273 3.75921 13.235L4.08733 13.8053L4.16155 13.9157C4.34844 14.1596 4.6385 14.3067 4.95062 14.3092L6.56585 14.3229L6.78265 14.3385C7.28292 14.4084 7.72931 14.7036 7.9887 15.1462L8.80999 16.5465L8.88421 16.6559C9.07298 16.8982 9.36422 17.0435 9.6762 17.0436H10.3227C10.6793 17.0436 11.0095 16.8542 11.1899 16.5465L12.0112 15.1462L12.1332 14.9655C12.4432 14.5668 12.9212 14.3271 13.434 14.3229L15.0492 14.3092L15.1811 14.2995C15.4854 14.2567 15.7569 14.076 15.9125 13.8053L16.2407 13.235L16.2983 13.1169C16.3983 12.8745 16.3999 12.6023 16.3022 12.359L16.2446 12.2399L15.4418 10.819C15.1551 10.311 15.1551 9.6893 15.4418 9.18131L16.2446 7.76041L16.3022 7.64127C16.4 7.39806 16.3982 7.12584 16.2983 6.88346L16.2407 6.7653L15.9125 6.19401C15.7568 5.92338 15.4855 5.74264 15.1811 5.69987L15.0492 5.6901L13.434 5.67741C12.9212 5.67322 12.4432 5.43341 12.1332 5.03483L12.0112 4.85416L11.1899 3.45377C11.0095 3.14604 10.6794 2.9567 10.3227 2.9567H9.6762ZM11.5854 9.99967C11.5852 9.12461 10.8755 8.41497 10.0004 8.41471C9.12516 8.41471 8.41466 9.12445 8.41448 9.99967C8.41448 10.875 9.12505 11.5846 10.0004 11.5846C10.8756 11.5844 11.5854 10.8749 11.5854 9.99967ZM12.9145 9.99967C12.9145 11.6094 11.6101 12.9145 10.0004 12.9147C8.39051 12.9147 7.08538 11.6096 7.08538 9.99967C7.08556 8.38991 8.39062 7.08463 10.0004 7.08463C11.61 7.08489 12.9143 8.39007 12.9145 9.99967Z"></path>
                    </svg>
                    <span>Personalization</span>
                  </button>
                </div>
                
                <div className="settings-tab-content">
                  <div className="settings-section">
                    <div className="settings-section-header">
                      <label className="settings-section-label">Custom instructions</label>
                    </div>
                    <div className="settings-section-description">
                      Set the style and tone ChatGPT uses when responding.
                    </div>
                    <textarea
                      className="settings-custom-instructions-input"
                      value={customInstructions}
                      onChange={(e) => setCustomInstructions(e.target.value)}
                      onBlur={saveSettings}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          await saveSettings();
                          setIsSettingsModalOpen(false);
                        }
                      }}
                      placeholder="Be innovative and think outside the box. Take a forward-thinking view."
                      rows={6}
                    />
                    <div className="settings-custom-instructions-hint">
                      Click enter to save the instructions, shift + enter for a new line.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
    }

export default App;
