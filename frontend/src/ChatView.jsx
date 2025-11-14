import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useNavigate } from 'react-router-dom';
import { CodeBlock } from './CodeBlock';
import jsPDF from 'jspdf';

function ChatView({ chatId, currentModel, onChatUpdate, onDeleteChat, onNewChat }) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState(null);
  const [chatTitle, setChatTitle] = useState('');
  const [openHeaderMenu, setOpenHeaderMenu] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState('');
  const messagesEndRef = useRef(null);
  const currentMessageRef = useRef('');
  const textareaRef = useRef(null);
  const previousChatIdRef = useRef(null);
  const previousMessagesCountRef = useRef(0);

  const deleteEmptyChat = async (id) => {
    try {
      const response = await fetch(`http://localhost:5001/api/chats/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (response.ok) {
        // Refresh the chat list in the sidebar
        if (onChatUpdate) {
          onChatUpdate();
        }
      }
    } catch (error) {
      console.error('Error deleting empty chat:', error);
    }
  };

  // Load chat messages when chatId changes
  useEffect(() => {
    const previousChatId = previousChatIdRef.current;
    const previousMessagesCount = previousMessagesCountRef.current;
    
    // If we're switching to a new chat and the previous chat was empty, delete it
    if (previousChatId && chatId && previousChatId !== chatId && previousMessagesCount === 0) {
      deleteEmptyChat(previousChatId);
    }
    
    // Update refs before loading new chat
    previousChatIdRef.current = chatId;
    
    if (chatId) {
      loadChat(chatId);
    } else {
      setMessages([]);
      previousMessagesCountRef.current = 0;
    }
  }, [chatId]);

  // Track message count for the current chat
  useEffect(() => {
    previousMessagesCountRef.current = messages.length;
  }, [messages.length]);

  // Focus input when chatId changes
  useEffect(() => {
    if (chatId && textareaRef.current) {
      // Small delay to ensure the component is fully rendered
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
  }, [chatId]);

  const loadChat = async (id) => {
    try {
      const response = await fetch(`http://localhost:5001/api/chats/${id}`, {
        credentials: 'include',
      });
      if (response.ok) {
        const chat = await response.json();
        setChatTitle(chat.title || 'Untitled Chat');
        // Convert database messages to display format
        const formattedMessages = chat.messages.map(msg => ({
          role: msg.role,
          content: msg.content
        }));
        setMessages(formattedMessages);
      }
    } catch (error) {
      console.error('Error loading chat:', error);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const sendMessage = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage = input.trim();
    setInput('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    setIsStreaming(true);

    // Add user message
    const newMessages = [...messages, { role: 'user', content: userMessage }];
    setMessages(newMessages);

    // Add empty assistant message that will be updated
    setMessages([...newMessages, { role: 'assistant', content: '' }]);
    currentMessageRef.current = '';

    try {
      const response = await fetch('http://localhost:5001/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          message: userMessage,
          model: currentModel,
          chat_id: chatId || null, // Include chat_id if we're in an existing chat, null for new chat
        }),
      });

      // If this is the first message, update chat list immediately after request is sent
      // The backend updates the title synchronously before streaming starts
      if (messages.length === 0 && onChatUpdate) {
        // Small delay to ensure backend has processed the title update
        setTimeout(() => {
          onChatUpdate();
        }, 200);
      }

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let receivedChatId = chatId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                currentMessageRef.current += data.content;
                setMessages([
                  ...newMessages,
                  { role: 'assistant', content: currentMessageRef.current },
                ]);
              }
              if (data.done) {
                if (data.chat_id && !receivedChatId) {
                  receivedChatId = data.chat_id;
                  // Navigate to the new chat
                  navigate(`/c/${data.chat_id}`);
                }
                // Always refresh chat list to update title in sidebar
                  if (onChatUpdate) {
                    onChatUpdate();
                }
                setIsStreaming(false);
                return;
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      console.error('Error:', error);
      setMessages([
        ...newMessages,
        { role: 'assistant', content: 'Error: Failed to get response' },
      ]);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    // Allow Shift+Enter for new lines
  };

  const copyMessage = async (content, index) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageIndex(index);
      setTimeout(() => setCopiedMessageIndex(null), 2000);
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = content;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopiedMessageIndex(index);
        setTimeout(() => setCopiedMessageIndex(null), 2000);
      } catch (e) {
        console.error('Failed to copy:', e);
      }
      document.body.removeChild(textArea);
    }
  };

  const downloadChatAsPDF = () => {
    if (!chatId || messages.length === 0) return;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const maxWidth = pageWidth - 2 * margin;
    let yPosition = margin;

    // Add title
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    const titleLines = doc.splitTextToSize(chatTitle, maxWidth);
    doc.text(titleLines, margin, yPosition);
    yPosition += titleLines.length * 8 + 10;

    // Add date
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(100, 100, 100);
    const dateStr = new Date().toLocaleDateString();
    doc.text(`Exported on: ${dateStr}`, margin, yPosition);
    yPosition += 10;

    // Add messages
    doc.setTextColor(0, 0, 0);
    messages.forEach((msg, index) => {
      // Check if we need a new page
      if (yPosition > pageHeight - 40) {
        doc.addPage();
        yPosition = margin;
      }

      // Add role label
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      const roleLabel = msg.role === 'user' ? 'You' : 'Assistant';
      doc.text(roleLabel, margin, yPosition);
      yPosition += 8;

      // Add message content
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      
      // Strip markdown formatting for PDF (simple approach)
      let textContent = msg.content;
      // Remove code blocks
      textContent = textContent.replace(/```[\s\S]*?```/g, '[Code block]');
      // Remove inline code
      textContent = textContent.replace(/`([^`]+)`/g, '$1');
      // Remove markdown links
      textContent = textContent.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
      // Remove markdown headers
      textContent = textContent.replace(/^#+\s+/gm, '');
      // Remove markdown bold/italic
      textContent = textContent.replace(/\*\*([^\*]+)\*\*/g, '$1');
      textContent = textContent.replace(/\*([^\*]+)\*/g, '$1');
      
      const contentLines = doc.splitTextToSize(textContent, maxWidth);
      doc.text(contentLines, margin, yPosition);
      yPosition += contentLines.length * 5 + 10;
    });

    // Save PDF
    const fileName = `${chatTitle.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.pdf`;
    doc.save(fileName);
    setOpenHeaderMenu(false);
  };

  const handleRename = async () => {
    if (!chatId || !tempTitle.trim()) {
      setEditingTitle(false);
      setTempTitle(chatTitle);
      return;
    }

    try {
      const response = await fetch(`http://localhost:5001/api/chats/${chatId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ title: tempTitle.trim() }),
      });

      if (response.ok) {
        setChatTitle(tempTitle.trim());
        setEditingTitle(false);
        if (onChatUpdate) {
          onChatUpdate();
        }
      } else {
        alert('Failed to rename chat');
        setTempTitle(chatTitle);
      }
    } catch (error) {
      console.error('Error renaming chat:', error);
      alert('Failed to rename chat');
      setTempTitle(chatTitle);
    }
    setOpenHeaderMenu(false);
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openHeaderMenu) {
        const menuWrapper = event.target.closest('.header-menu-wrapper');
        const menuDropdown = event.target.closest('.header-menu-dropdown');
        // Only close if clicking outside both the wrapper and dropdown
        if (!menuWrapper && !menuDropdown) {
          setOpenHeaderMenu(false);
        }
      }
    };

    if (openHeaderMenu) {
      // Use a slight delay to allow button clicks to register first
      setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 0);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openHeaderMenu]);

  return (
    <div className="main-content-wrapper">
      {/* Header */}
      <div className="app-header">
        <img 
          src="/images/jk_svg.svg" 
          alt="JK" 
          className="header-logo" 
          onClick={() => {
            if (onNewChat) {
              onNewChat();
            }
          }}
          style={{ cursor: 'pointer' }}
        />
        <span 
          className="header-title"
          onClick={() => {
            if (onNewChat) {
              onNewChat();
            }
          }}
          style={{ cursor: 'pointer' }}
        >
          Jonas Klein Chat
        </span>
        {chatId && (
          <div className="header-menu-wrapper">
            <button
              className="header-menu-btn"
              onClick={() => setOpenHeaderMenu(!openHeaderMenu)}
              aria-label="Chat options"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="icon">
                <path d="M15.498 8.50159C16.3254 8.50159 16.9959 9.17228 16.9961 9.99963C16.9961 10.8271 16.3256 11.4987 15.498 11.4987C14.6705 11.4987 14 10.8271 14 9.99963C14.0002 9.17228 14.6706 8.50159 15.498 8.50159Z"></path>
                <path d="M4.49805 8.50159C5.32544 8.50159 5.99689 9.17228 5.99707 9.99963C5.99707 10.8271 5.32555 11.4987 4.49805 11.4987C3.67069 11.4985 3 10.827 3 9.99963C3.00018 9.17239 3.6708 8.50176 4.49805 8.50159Z"></path>
                <path d="M10.0003 8.50159C10.8276 8.50176 11.4982 9.17239 11.4984 9.99963C11.4984 10.827 10.8277 11.4985 10.0003 11.4987C9.17283 11.4987 8.50131 10.8271 8.50131 9.99963C8.50149 9.17228 9.17294 8.50159 10.0003 8.50159Z"></path>
          </svg>
            </button>
            {openHeaderMenu && (
              <div className="header-menu-dropdown">
                {editingTitle ? (
                  <div className="header-menu-rename-input-wrapper">
                    <input
                      className="header-menu-rename-input"
                      value={tempTitle}
                      onChange={(e) => setTempTitle(e.target.value)}
                      onBlur={handleRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleRename();
                        } else if (e.key === 'Escape') {
                          setEditingTitle(false);
                          setTempTitle(chatTitle);
                          setOpenHeaderMenu(false);
                        }
                      }}
                      autoFocus
                    />
                  </div>
                ) : (
                  <button
                    className="header-menu-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingTitle(true);
                      setTempTitle(chatTitle);
                    }}
                    aria-label="Rename chat"
                  >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="icon">
                    <path d="M11.3312 3.56837C12.7488 2.28756 14.9376 2.33009 16.3038 3.6963L16.4318 3.83106C17.6712 5.20294 17.6712 7.29708 16.4318 8.66895L16.3038 8.80372L10.0118 15.0947C9.68833 15.4182 9.45378 15.6553 9.22179 15.8457L8.98742 16.0225C8.78227 16.1626 8.56423 16.2832 8.33703 16.3828L8.10753 16.4756C7.92576 16.5422 7.73836 16.5902 7.5216 16.6348L6.75695 16.7705L4.36339 17.169C4.22053 17.1928 4.06908 17.2188 3.94054 17.2285C3.84177 17.236 3.70827 17.2386 3.56261 17.2031L3.41417 17.1543C3.19115 17.0586 3.00741 16.8908 2.89171 16.6797L2.84581 16.5859C2.75951 16.3846 2.76168 16.1912 2.7716 16.0596C2.7813 15.931 2.80736 15.7796 2.83117 15.6367L3.2296 13.2432L3.36437 12.4785C3.40893 12.2616 3.45789 12.0745 3.52453 11.8926L3.6173 11.6621C3.71685 11.4352 3.83766 11.2176 3.97765 11.0127L4.15343 10.7783C4.34386 10.5462 4.58164 10.312 4.90538 9.98829L11.1964 3.6963L11.3312 3.56837ZM5.84581 10.9287C5.49664 11.2779 5.31252 11.4634 5.18663 11.6162L5.07531 11.7627C4.98188 11.8995 4.90151 12.0448 4.83507 12.1963L4.77355 12.3506C4.73321 12.4607 4.70242 12.5761 4.66808 12.7451L4.54113 13.4619L4.14269 15.8555L4.14171 15.8574H4.14464L6.5382 15.458L7.25499 15.332C7.424 15.2977 7.5394 15.2669 7.64953 15.2266L7.80285 15.165C7.95455 15.0986 8.09947 15.0174 8.23644 14.9238L8.3839 14.8135C8.53668 14.6876 8.72225 14.5035 9.0714 14.1543L14.0587 9.16602L10.8331 5.94044L5.84581 10.9287ZM15.3634 4.63673C14.5281 3.80141 13.2057 3.74938 12.3097 4.48048L12.1368 4.63673L11.7735 5.00001L15.0001 8.22559L15.3634 7.86329L15.5196 7.68946C16.2015 6.85326 16.2015 5.64676 15.5196 4.81056L15.3634 4.63673Z"></path>
          </svg>
                  <span>Rename</span>
                </button>
                )}
                {messages.length > 0 && (
                  <>
                    <button
                      className="header-menu-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadChatAsPDF();
                      }}
                      aria-label="Download chat as PDF"
                    >
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="icon">
                        <path d="M10 2.5C10.4142 2.5 10.75 2.83579 10.75 3.25V11.4393L12.9697 9.21967C13.2626 8.92678 13.7374 8.92678 14.0303 9.21967C14.3232 9.51256 14.3232 9.98744 14.0303 10.2803L10.5303 13.7803C10.2374 14.0732 9.76256 14.0732 9.46967 13.7803L5.96967 10.2803C5.67678 9.98744 5.67678 9.51256 5.96967 9.21967C6.26256 8.92678 6.73744 8.92678 7.03033 9.21967L9.25 11.4393V3.25C9.25 2.83579 9.58579 2.5 10 2.5Z"></path>
                        <path d="M3.5 14.25C3.5 13.8358 3.16421 13.5 2.75 13.5C2.33579 13.5 2 13.8358 2 14.25V16.25C2 17.2165 2.7835 18 3.75 18H16.25C17.2165 18 18 17.2165 18 16.25V14.25C18 13.8358 17.6642 13.5 17.25 13.5C16.8358 13.5 16.5 13.8358 16.5 14.25V16H3.5V14.25Z"></path>
            </svg>
                      <span>Download</span>
          </button>
                    <button
                      className="header-menu-item header-menu-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenHeaderMenu(false);
                        if (onDeleteChat && chatId) {
                          // Create a chat object for the delete confirmation
                          const chat = { id: chatId, title: chatTitle, messages: messages };
                          // Call confirmDeleteChat with chatId and event
                          onDeleteChat(chatId, e);
                        }
                      }}
                      aria-label="Delete chat"
                    >
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="icon" aria-hidden="true">
                        <path d="M10.6299 1.33496C12.0335 1.33496 13.2695 2.25996 13.666 3.60645L13.8809 4.33496H17L17.1338 4.34863C17.4369 4.41057 17.665 4.67858 17.665 5C17.665 5.32142 17.4369 5.58943 17.1338 5.65137L17 5.66504H16.6543L15.8574 14.9912C15.7177 16.629 14.3478 17.8877 12.7041 17.8877H7.2959C5.75502 17.8877 4.45439 16.7815 4.18262 15.2939L4.14258 14.9912L3.34668 5.66504H3C2.63273 5.66504 2.33496 5.36727 2.33496 5C2.33496 4.63273 2.63273 4.33496 3 4.33496H6.11914L6.33398 3.60645L6.41797 3.3584C6.88565 2.14747 8.05427 1.33496 9.37012 1.33496H10.6299ZM5.46777 14.8779L5.49121 15.0537C5.64881 15.9161 6.40256 16.5576 7.2959 16.5576H12.7041C13.6571 16.5576 14.4512 15.8275 14.5322 14.8779L15.3193 5.66504H4.68164L5.46777 14.8779ZM7.66797 12.8271V8.66016C7.66797 8.29299 7.96588 7.99528 8.33301 7.99512C8.70028 7.99512 8.99805 8.29289 8.99805 8.66016V12.8271C8.99779 13.1942 8.70012 13.4912 8.33301 13.4912C7.96604 13.491 7.66823 13.1941 7.66797 12.8271ZM11.002 12.8271V8.66016C11.002 8.29289 11.2997 7.99512 11.667 7.99512C12.0341 7.9953 12.332 8.293 12.332 8.66016V12.8271C12.3318 13.1941 12.0339 13.491 11.667 13.4912C11.2999 13.4912 11.0022 13.1942 11.002 12.8271ZM9.37012 2.66504C8.60726 2.66504 7.92938 3.13589 7.6582 3.83789L7.60938 3.98145L7.50586 4.33496H12.4941L12.3906 3.98145C12.1607 3.20084 11.4437 2.66504 10.6299 2.66504H9.37012Z"></path>
            </svg>
                      <span>Delete</span>
          </button>
                  </>
                )}
              </div>
            )}
        </div>
        )}
      </div>
      <div className="main-content">
        <div className={`messages-container ${messages.length > 0 ? 'has-messages' : ''}`}>
          {messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-text">Start a conversation</div>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} className={`message ${msg.role}`}>
                <div className="message-wrapper">
                <div className="message-content">
                  {msg.content ? (
                    <ReactMarkdown 
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code: ({ node, inline, className, children, ...props }) => {
                          const match = /language-(\w+)/.exec(className || '');
                          const language = match ? match[1] : '';
                          const codeString = String(children).replace(/\n$/, '');
                          
                          return !inline && language ? (
                            <CodeBlock language={language} codeString={codeString} />
                          ) : (
                            <code className={className} {...props}>
                              {children}
                            </code>
                          );
                        },
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  ) : (
                    <i className="fa-solid fa-circle fa-beat"></i>
                    )}
                  </div>
                  {msg.content && (
                    <button 
                      className="message-copy-btn"
                      onClick={() => copyMessage(msg.content, idx)}
                      aria-label={copiedMessageIndex === idx ? "Copied" : "Copy message"}
                    >
                      {copiedMessageIndex === idx ? (
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="icon-sm">
                          <path d="M16.5 5.5L7.5 14.5L3.5 10.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="icon-sm">
                          <path d="M12.668 10.667C12.668 9.95614 12.668 9.46258 12.6367 9.0791C12.6137 8.79732 12.5758 8.60761 12.5244 8.46387L12.4688 8.33399C12.3148 8.03193 12.0803 7.77885 11.793 7.60254L11.666 7.53125C11.508 7.45087 11.2963 7.39395 10.9209 7.36328C10.5374 7.33197 10.0439 7.33203 9.33301 7.33203H6.5C5.78896 7.33203 5.29563 7.33195 4.91211 7.36328C4.63016 7.38632 4.44065 7.42413 4.29688 7.47559L4.16699 7.53125C3.86488 7.68518 3.61186 7.9196 3.43555 8.20703L3.36524 8.33399C3.28478 8.49198 3.22795 8.70352 3.19727 9.0791C3.16595 9.46259 3.16504 9.95611 3.16504 10.667V13.5C3.16504 14.211 3.16593 14.7044 3.19727 15.0879C3.22797 15.4636 3.28473 15.675 3.36524 15.833L3.43555 15.959C3.61186 16.2466 3.86474 16.4807 4.16699 16.6348L4.29688 16.6914C4.44063 16.7428 4.63025 16.7797 4.91211 16.8027C5.29563 16.8341 5.78896 16.835 6.5 16.835H9.33301C10.0439 16.835 10.5374 16.8341 10.9209 16.8027C11.2965 16.772 11.508 16.7152 11.666 16.6348L11.793 16.5645C12.0804 16.3881 12.3148 16.1351 12.4688 15.833L12.5244 15.7031C12.5759 15.5594 12.6137 15.3698 12.6367 15.0879C12.6681 14.7044 12.668 14.211 12.668 13.5V10.667ZM13.998 12.665C14.4528 12.6634 14.8011 12.6602 15.0879 12.6367C15.4635 12.606 15.675 12.5492 15.833 12.4688L15.959 12.3975C16.2466 12.2211 16.4808 11.9682 16.6348 11.666L16.6914 11.5361C16.7428 11.3924 16.7797 11.2026 16.8027 10.9209C16.8341 10.5374 16.835 10.0439 16.835 9.33301V6.5C16.835 5.78896 16.8341 5.29563 16.8027 4.91211C16.7797 4.63025 16.7428 4.44063 16.6914 4.29688L16.6348 4.16699C16.4807 3.86474 16.2466 3.61186 15.959 3.43555L15.833 3.36524C15.675 3.28473 15.4636 3.22797 15.0879 3.19727C14.7044 3.16593 14.211 3.16504 13.5 3.16504H10.667C9.9561 3.16504 9.46259 3.16595 9.0791 3.19727C8.79739 3.22028 8.6076 3.2572 8.46387 3.30859L8.33399 3.36524C8.03176 3.51923 7.77886 3.75343 7.60254 4.04102L7.53125 4.16699C7.4508 4.32498 7.39397 4.53655 7.36328 4.91211C7.33985 5.19893 7.33562 5.54719 7.33399 6.00195H9.33301C10.022 6.00195 10.5791 6.00131 11.0293 6.03809C11.4873 6.07551 11.8937 6.15471 12.2705 6.34668L12.4883 6.46875C12.984 6.7728 13.3878 7.20854 13.6533 7.72949L13.7197 7.87207C13.8642 8.20859 13.9292 8.56974 13.9619 8.9707C13.9987 9.42092 13.998 9.97799 13.998 10.667V12.665ZM18.165 9.33301C18.165 10.022 18.1657 10.5791 18.1289 11.0293C18.0961 11.4302 18.0311 11.7914 17.8867 12.1279L17.8203 12.2705C17.5549 12.7914 17.1509 13.2272 16.6553 13.5313L16.4365 13.6533C16.0599 13.8452 15.6541 13.9245 15.1963 13.9619C14.8593 13.9895 14.4624 13.9935 13.9951 13.9951C13.9935 14.4624 13.9895 14.8593 13.9619 15.1963C13.9292 15.597 13.864 15.9576 13.7197 16.2939L13.6533 16.4365C13.3878 16.9576 12.9841 17.3941 12.4883 17.6982L12.2705 17.8203C11.8937 18.0123 11.4873 18.0915 11.0293 18.1289C10.5791 18.1657 10.022 18.165 9.33301 18.165H6.5C5.81091 18.165 5.25395 18.1657 4.80371 18.1289C4.40306 18.0962 4.04235 18.031 3.70606 17.8867L3.56348 17.8203C3.04244 17.5548 2.60585 17.151 2.30176 16.6553L2.17969 16.4365C1.98788 16.0599 1.90851 15.6541 1.87109 15.1963C1.83431 14.746 1.83496 14.1891 1.83496 13.5V10.667C1.83496 9.978 1.83432 9.42091 1.87109 8.9707C1.90851 8.5127 1.98772 8.10625 2.17969 7.72949L2.30176 7.51172C2.60586 7.0159 3.04236 6.6122 3.56348 6.34668L3.70606 6.28027C4.04237 6.136 4.40303 6.07083 4.80371 6.03809C5.14051 6.01057 5.53708 6.00551 6.00391 6.00391C6.00551 5.53708 6.01057 5.14051 6.03809 4.80371C6.0755 4.34588 6.15483 3.94012 6.34668 3.56348L6.46875 3.34473C6.77282 2.84912 7.20856 2.44514 7.72949 2.17969L7.87207 2.11328C8.20855 1.96886 8.56979 1.90385 8.9707 1.87109C9.42091 1.83432 9.978 1.83496 10.667 1.83496H13.5C14.1891 1.83496 14.746 1.83431 15.1963 1.87109C15.6541 1.90851 16.0599 1.98788 16.4365 2.17969L16.6553 2.30176C17.151 2.60585 17.5548 3.04244 17.8203 3.56348L17.8867 3.70606C18.031 4.04235 18.0962 4.40306 18.1289 4.80371C18.1657 5.25395 18.165 5.81091 18.165 6.5V9.33301Z"></path>
                        </svg>
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="input-area">
          <div className="input-wrapper">
            <textarea
              ref={textareaRef}
              className="message-input"
              placeholder="Ask anything"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={isStreaming}
              rows={1}
            />
            <button
              className="send-btn"
              onClick={sendMessage}
              disabled={!input.trim() || isStreaming}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="icon">
                <path d="M8.99992 16V6.41407L5.70696 9.70704C5.31643 10.0976 4.68342 10.0976 4.29289 9.70704C3.90237 9.31652 3.90237 8.6835 4.29289 8.29298L9.29289 3.29298L9.36907 3.22462C9.76184 2.90427 10.3408 2.92686 10.707 3.29298L15.707 8.29298L15.7753 8.36915C16.0957 8.76192 16.0731 9.34092 15.707 9.70704C15.3408 10.0732 14.7618 10.0958 14.3691 9.7754L14.2929 9.70704L10.9999 6.41407V16C10.9999 16.5523 10.5522 17 9.99992 17C9.44764 17 8.99992 16.5523 8.99992 16Z"></path>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChatView;

