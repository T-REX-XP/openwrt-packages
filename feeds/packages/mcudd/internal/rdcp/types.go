package rdcp

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
	MsgLegacyRequest
	MsgReq
	MsgReqPoweroff
	MsgResPing
	MsgEvt
	MsgEvtVersion
	MsgEvtEcho
	MsgEvtInput
)

type Message struct {
	Type              MsgType
	Scope             Scope
	ReqID             uint
	Screen            string
	GestureDir        string
	EchoText          string
	VersionStack      string
	VersionComponent  string
	VersionRelease    uint
	VersionRDCP       uint
	UptimeMS          uint
	Op                string
}
