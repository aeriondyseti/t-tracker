package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/aerion/t/internal/api"
	"github.com/aerion/t/internal/store"
)

func main() {
	// Setup JSON logging to stderr
	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// Determine data directory
	dataDir := os.Getenv("T_DAEMON_DATA_DIR")
	if dataDir == "" {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			slog.Error("failed to get home directory", "error", err)
			os.Exit(1)
		}
		dataDir = filepath.Join(homeDir, ".local", "share", "t")
	}
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		slog.Error("failed to create data directory", "path", dataDir, "error", err)
		os.Exit(1)
	}

	dbPath := filepath.Join(dataDir, "local.db")
	slog.Info("opening database", "path", dbPath)

	// Open store
	st, err := store.New(dbPath)
	if err != nil {
		slog.Error("failed to open store", "error", err)
		os.Exit(1)
	}
	defer st.Close()

	// Setup HTTP handlers
	handlers := api.New(st)
	router := handlers.Router()

	// Determine port
	port := os.Getenv("T_DAEMON_PORT")
	if port == "" {
		port = "9999"
	}
	if _, err := strconv.Atoi(port); err != nil {
		slog.Error("invalid port", "port", port, "error", err)
		os.Exit(1)
	}

	addr := "127.0.0.1:" + port
	server := &http.Server{
		Addr:    addr,
		Handler: router,
	}

	// Start server in goroutine
	serverErr := make(chan error, 1)
	go func() {
		slog.Info("daemon starting", "addr", addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			serverErr <- err
		}
	}()

	// Wait for interrupt signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-serverErr:
		slog.Error("server failed", "error", err)
		os.Exit(1)
	case sig := <-sigChan:
		slog.Info("received signal, shutting down", "signal", sig.String())
	}

	// Graceful shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		slog.Error("server shutdown failed", "error", err)
		os.Exit(1)
	}

	slog.Info("daemon stopped")
}
