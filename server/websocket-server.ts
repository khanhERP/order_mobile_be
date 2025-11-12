// @ts-nocheck
import WebSocket, { WebSocketServer } from 'ws';
import { Server } from 'http';

let wss: WebSocketServer | null = null;
// Keep track of all connected clients
const clients = new Set<WebSocket>();

// Global state for customer display
let currentCartState = {
  cart: [],
  subtotal: 0,
  tax: 0,
  total: 0,
  storeInfo: null,
  qrPayment: null
};

export function initializeWebSocketServer(server: Server) {
  if (wss) {
    console.log('WebSocket server already running');
    return;
  }

  try {
    wss = new WebSocketServer({
      server,
      path: '/ws',
      perMessageDeflate: false,
      maxPayload: 16 * 1024 // 16KB
    });
    console.log('✅ WebSocket server created successfully on path /ws');
  } catch (error) {
    console.error('Failed to create WebSocket server:', error);
    return;
  }

  wss.on('connection', (ws, request) => {
    console.log('📡 Client connected to WebSocket:', {
      url: request.url,
      origin: request.headers.origin,
      userAgent: request.headers['user-agent']?.substring(0, 50) + '...'
    });

    clients.add(ws);

    // Send initial ping to confirm connection
    try {
      ws.send(JSON.stringify({
        type: 'connection_established',
        timestamp: new Date().toISOString()
      }));
    } catch (error) {
      console.error('❌ Error sending connection confirmation:', error);
    }

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('📩 Received WebSocket message:', data);

        // Handle different message types
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        } else if (data.type === 'register_order_management') {
          console.log('✅ Order Management client registered');
          (ws as any).clientType = 'order_management';
        } else if (data.type === 'register_table_grid') {
          console.log('✅ Table Grid client registered');
          (ws as any).clientType = 'table_grid';
        } else if (data.type === 'register_table_management') {
          console.log('✅ Table Management client registered');
          (ws as any).clientType = 'table_management';
        } else if (data.type === 'register_pos') {
          console.log('✅ POS client registered');
          (ws as any).clientType = 'pos';
        } else if (data.type === 'cart_update') {
          console.log('📡 WebSocket: Cart update received and broadcasting to customer displays', {
            cartItems: data.cart?.length || 0,
            subtotal: data.subtotal,
            tax: data.tax,
            total: data.total,
            connectedClients: wss.clients.size
          });

          // Ensure cart items have proper names
          const validatedCart = (data.cart || []).map(item => ({
            ...item,
            name: item.name || item.productName || item.product?.name || `Sản phẩm ${item.id || item.productId}`,
            productName: item.name || item.productName || item.product?.name || `Sản phẩm ${item.id || item.productId}`
          }));

          // Log cart items for debugging
          console.log('📦 Cart items:', validatedCart.map(item => ({
            productName: item.name || 'Unknown',
            quantity: item.quantity,
            price: item.price,
            total: item.total
          })));

          // Create validated message with proper order number
          const validatedMessage = {
            ...data,
            cart: validatedCart,
            orderNumber: data.orderNumber || `ORD-${Date.now()}`
          };

          // Broadcast to all connected clients (especially customer displays)
          let broadcastCount = 0;
          wss.clients.forEach((client: WebSocket) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try {
                client.send(JSON.stringify(validatedMessage));
                broadcastCount++;
              } catch (error) {
                console.error('📡 Error broadcasting cart update:', error);
              }
            }
          });

          console.log(`✅ Cart update broadcasted to ${broadcastCount} clients`);
        } else if (data.type === 'qr_payment') {
          console.log('📱 Received QR payment request:', {
            hasQrCodeUrl: !!data.qrCodeUrl,
            qrCodeUrlLength: data.qrCodeUrl?.length || 0,
            amount: data.amount,
            paymentMethod: data.paymentMethod,
            transactionUuid: data.transactionUuid,
            clientsCount: clients.size
          });

          // Validate QR payment data first
          if (!data.qrCodeUrl || !data.amount) {
            console.error('❌ Invalid QR payment data received:', {
              hasQrCodeUrl: !!data.qrCodeUrl,
              hasAmount: !!data.amount,
              data: data
            });
            return;
          }

          // Update global QR payment state
          currentCartState.qrPayment = {
            qrCodeUrl: data.qrCodeUrl,
            amount: Number(data.amount),
            paymentMethod: data.paymentMethod || 'QR Code',
            transactionUuid: data.transactionUuid || `QR-${Date.now()}`
          };

          // Clear cart state when QR payment is shown
          currentCartState.cart = [];
          currentCartState.subtotal = 0;
          currentCartState.tax = 0;
          currentCartState.total = 0;

          console.log('✅ Updated global QR payment state:', {
            hasQrCodeUrl: !!currentCartState.qrPayment.qrCodeUrl,
            amount: currentCartState.qrPayment.amount,
            paymentMethod: currentCartState.qrPayment.paymentMethod,
            transactionUuid: currentCartState.qrPayment.transactionUuid
          });

          // Create validated QR message
          const qrMessage = {
            type: 'qr_payment',
            qrCodeUrl: data.qrCodeUrl,
            amount: Number(data.amount),
            paymentMethod: data.paymentMethod || 'QR Code',
            transactionUuid: data.transactionUuid || `QR-${Date.now()}`,
            timestamp: new Date().toISOString()
          };

          console.log('📡 Broadcasting QR payment to all clients:', {
            messageType: qrMessage.type,
            hasQrCodeUrl: !!qrMessage.qrCodeUrl,
            amount: qrMessage.amount,
            clientsCount: clients.size,
            timestamp: qrMessage.timestamp
          });

          // Broadcast QR payment info to all clients (especially customer displays)
          let qrBroadcastCount = 0;
          let customerDisplayCount = 0;

          console.log('🔍 Available clients for QR broadcast:', {
            totalClients: clients.size,
            clientDetails: Array.from(clients).map(client => ({
              clientType: (client as any).clientType || 'unknown',
              isCustomerDisplay: (client as any).isCustomerDisplay || false,
              readyState: client.readyState,
              isOpen: client.readyState === WebSocket.OPEN
            }))
          });

          clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client !== ws) {
              try {
                const clientType = (client as any).clientType || 'unknown';
                const isCustomerDisplay = (client as any).isCustomerDisplay || clientType === 'customer_display';
                
                console.log(`📤 Sending QR payment to client (type: ${clientType}, isCustomerDisplay: ${isCustomerDisplay}):`, {
                  hasQrCodeUrl: !!qrMessage.qrCodeUrl,
                  amount: qrMessage.amount,
                  qrCodeStart: qrMessage.qrCodeUrl ? qrMessage.qrCodeUrl.substring(0, 30) + '...' : 'null'
                });
                
                client.send(JSON.stringify(qrMessage));
                qrBroadcastCount++;
                
                if (isCustomerDisplay) {
                  customerDisplayCount++;
                  console.log(`✅ QR payment sent to customer display #${customerDisplayCount}`);
                  
                  // Send a verification message after a short delay to ensure delivery
                  setTimeout(() => {
                    if (client.readyState === WebSocket.OPEN) {
                      try {
                        client.send(JSON.stringify({
                          type: 'qr_payment_confirmation',
                          originalMessage: qrMessage,
                          timestamp: new Date().toISOString(),
                          verification: 'delivery_confirmation'
                        }));
                        console.log(`🔔 QR payment confirmation sent to customer display #${customerDisplayCount}`);
                      } catch (confirmError) {
                        console.error('❌ Error sending QR confirmation:', confirmError);
                      }
                    }
                  }, 100);
                }
              } catch (error) {
                console.error('❌ Error broadcasting QR payment to client:', error);
              }
            }
          });
          
          console.log(`✅ QR payment broadcasted to ${qrBroadcastCount} total clients (${customerDisplayCount} customer displays)`);
          
          // Additional broadcast specifically to customer displays after a short delay
          setTimeout(() => {
            let additionalBroadcastCount = 0;
            clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                const isCustomerDisplay = (client as any).isCustomerDisplay || (client as any).clientType === 'customer_display';
                if (isCustomerDisplay) {
                  try {
                    console.log(`📤 Additional QR broadcast to customer display`);
                    client.send(JSON.stringify(qrMessage));
                    additionalBroadcastCount++;
                  } catch (error) {
                    console.error('❌ Error in additional QR broadcast:', error);
                  }
                }
              }
            });
            console.log(`🔄 Additional QR payment broadcast sent to ${additionalBroadcastCount} customer displays`);
          }, 500);
        } else if (data.type === 'customer_display_connected' || data.type === 'register_customer_display') {
          console.log('👥 Customer display connected - sending current state');
          // Mark this connection as customer display
          (ws as any).isCustomerDisplay = true;
          (ws as any).clientType = 'customer_display';
          
          console.log('✅ Customer display registered:', {
            clientType: (ws as any).clientType,
            isCustomerDisplay: (ws as any).isCustomerDisplay,
            totalClients: clients.size
          });

          // Send current cart state to newly connected customer display
          try {
            // Always send cart update first
            const cartMessage = {
              type: 'cart_update',
              cart: currentCartState.cart,
              subtotal: currentCartState.subtotal,
              tax: currentCartState.tax,
              total: currentCartState.total,
              timestamp: new Date().toISOString()
            };
            ws.send(JSON.stringify(cartMessage));
            console.log('📤 Sent cart update to customer display:', {
              cartItems: currentCartState.cart.length,
              subtotal: currentCartState.subtotal,
              total: currentCartState.total
            });

            // Send store info if available
            if (currentCartState.storeInfo) {
              ws.send(JSON.stringify({
                type: 'store_info',
                storeInfo: currentCartState.storeInfo,
                timestamp: new Date().toISOString()
              }));
              console.log('📤 Sent store info to customer display');
            }

            // Send QR payment if available
            if (currentCartState.qrPayment) {
              const qrMessage = {
                type: 'qr_payment',
                ...currentCartState.qrPayment,
                timestamp: new Date().toISOString()
              };
              ws.send(JSON.stringify(qrMessage));
              console.log('📤 Sent QR payment to customer display:', {
                hasQrCodeUrl: !!currentCartState.qrPayment.qrCodeUrl,
                amount: currentCartState.qrPayment.amount
              });
            }

            console.log('✅ Customer display registration complete and state synchronized');
          } catch (error) {
            console.error('❌ Failed to send current state to customer display:', error);
          }
        } else if (data.type === 'qr_payment_cancelled') {
          console.log('🚫 QR payment cancelled, clearing QR payment state');
          currentCartState.qrPayment = null;
          
          // Broadcast cancellation to all customer displays
          clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client !== ws) {
              const isCustomerDisplay = (client as any).isCustomerDisplay || (client as any).clientType === 'customer_display';
              if (isCustomerDisplay) {
                try {
                  client.send(JSON.stringify({
                    type: 'qr_payment_cancelled',
                    timestamp: new Date().toISOString()
                  }));
                  console.log('📤 QR payment cancellation sent to customer display');
                } catch (error) {
                  console.error('❌ Error sending QR payment cancellation:', error);
                }
              }
            }
          });
        } else if (data.type === 'restore_cart_display') {
          console.log('🔄 Restoring cart display, clearing QR payment state');
          currentCartState.qrPayment = null;
          
          // Broadcast restore command to customer displays
          clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client !== ws) {
              const isCustomerDisplay = (client as any).isCustomerDisplay || (client as any).clientType === 'customer_display';
              if (isCustomerDisplay) {
                try {
                  client.send(JSON.stringify({
                    type: 'restore_cart_display',
                    timestamp: new Date().toISOString()
                  }));
                  console.log('📤 Restore cart display sent to customer display');
                } catch (error) {
                  console.error('❌ Error sending restore cart display:', error);
                }
              }
            }
          });
        } else if (data.type === 'popup_close' || data.type === 'payment_success' || data.type === 'order_status_update' || data.type === 'force_refresh' || data.type === 'einvoice_published' || data.type === 'einvoice_saved_for_later') {
          // Broadcast data refresh signals to all connected table grids and order management clients
          console.log(`📡 Broadcasting ${data.type} to all clients`);
          // Handle payment success specifically
          if (data.type === 'payment_success') {
            console.log('💰 Payment success received, clearing all states');
            // Clear cart state and QR payment on payment success
            currentCartState = {
              cart: [],
              subtotal: 0,
              tax: 0,
              total: 0,
              storeInfo: currentCartState.storeInfo,
              qrPayment: null
            };
            console.log('✅ Payment success - cleared cart and QR payment state');
          }

          clients.forEach(client => {
            if (client.readyState === client.OPEN && client !== ws) {
              const clientType = (client as any).clientType;
              if (clientType === 'table_grid' || clientType === 'order_management' || clientType === 'table_management' || clientType === 'pos') {
                client.send(JSON.stringify({
                  type: data.type,
                  source: data.source || 'unknown',
                  reason: data.reason || 'data_refresh',
                  action: data.action || 'refresh',
                  invoiceId: data.invoiceId || null,
                  invoiceNumber: data.invoiceNumber || null,
                  success: data.success !== undefined ? data.success : true,
                  timestamp: data.timestamp || new Date().toISOString()
                }));
              }
            }
          });
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    });

    ws.on('close', (code, reason) => {
      console.log('📡 Client disconnected:', {
        code,
        reason: reason.toString(),
        clientType: (ws as any).clientType || 'unknown'
      });
      clients.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', {
        error: error.message,
        clientType: (ws as any).clientType || 'unknown'
      });
      clients.delete(ws);
    });

    ws.on('pong', () => {
      console.log('🏓 Pong received from client');
    });
  });

  console.log('WebSocket server started on the same port as HTTP server');
}

export function broadcastPopupClose(success: boolean) {
  if (wss) {
    const message = JSON.stringify({
      type: 'popup_close',
      success
    });

    wss.clients.forEach((client: WebSocket) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });

    console.log('Broadcasted popup close signal:', { success });
  }
}

export function broadcastPaymentSuccess(transactionUuid: string) {
  if (wss) {
    const message = JSON.stringify({
      type: 'payment_success',
      transactionUuid
    });

    wss.clients.forEach((client: WebSocket) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });

    console.log('Broadcasted payment success:', { transactionUuid });
  }
}