package proto

type Scope int

const (
	ScopeNone Scope = iota
	ScopeSystem
	ScopeNetwork
	ScopeStorage
	ScopeAlarms
	ScopeClients
	ScopeWiFi
	ScopeSecurity
)

type MsgType int

const (
	MsgUnknown MsgType = iota
	MsgIgnored
	MsgLegacyRequest
	MsgReq
	MsgReqPoweroff
	MsgResPing
	MsgEvtScreen
	MsgEvtVersion
	MsgEvtEcho
)

type Message struct {
	Type             MsgType
	Scope            Scope
	ReqID            uint
	Screen           string
	EchoText         string
	VersionStack     string
	VersionComponent string
	VersionRelease   uint
	VersionRDCP      uint
	UptimeMS         uint
	Op               string
}
