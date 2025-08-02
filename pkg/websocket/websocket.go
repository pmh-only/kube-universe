package websocket

import (
	"log"
	"net/http"
	"time"

	renderer "github.com/afritzler/kube-universe/pkg/renderer"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow connections from any origin
	},
}

type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	kubeconfig string
	lastData   []byte
}

type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
}

func NewHub(kubeconfig string) *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		kubeconfig: kubeconfig,
		lastData:   nil,
	}
}

func (h *Hub) Run() {
	ticker := time.NewTicker(3 * time.Second) // Check every 3 seconds for faster updates
	defer ticker.Stop()

	go func() {
		for {
			select {
			case <-ticker.C:
				// Only fetch if we have clients
				if len(h.clients) > 0 {
					h.fetchAndBroadcast()
				}
			}
		}
	}()

	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
			log.Printf("Client connected. Total clients: %d", len(h.clients))
			// Send initial data to new client
			go h.sendInitialData(client)

		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				log.Printf("Client disconnected. Total clients: %d", len(h.clients))
			}

		case message := <-h.broadcast:
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
		}
	}
}

func (h *Hub) fetchAndBroadcast() {
	data, err := renderer.GetGraph(h.kubeconfig)
	if err != nil {
		log.Printf("Failed to fetch graph data: %v", err)
		return
	}

	// Only broadcast if data has changed
	if h.lastData == nil || !bytesEqual(h.lastData, data) {
		log.Printf("Graph data changed, broadcasting to %d clients", len(h.clients))
		h.lastData = make([]byte, len(data))
		copy(h.lastData, data)
		h.broadcast <- data
	}
}

func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func (h *Hub) sendInitialData(client *Client) {
	data, err := renderer.GetGraph(h.kubeconfig)
	if err != nil {
		log.Printf("Failed to fetch initial graph data: %v", err)
		return
	}

	// Store the data as lastData if it's the first client
	if h.lastData == nil {
		h.lastData = make([]byte, len(data))
		copy(h.lastData, data)
	}

	select {
	case client.send <- data:
	default:
		close(client.send)
		delete(h.clients, client)
	}
}

func (h *Hub) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	client := &Client{
		hub:  h,
		conn: conn,
		send: make(chan []byte, 256),
	}

	client.hub.register <- client

	go client.writePump()
	go client.readPump()
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(512)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
