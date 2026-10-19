import com.sun.jdi.*;
import com.sun.jdi.connect.*;
import com.sun.jdi.event.*;
import com.sun.jdi.request.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;

public final class CodeFlowTracer {
    private VirtualMachine vm;
    private final Set<String> userClasses=new HashSet<>();
    private final Map<Long,String> objectIds=new LinkedHashMap<>();
    private final List<String> frameKeys=new ArrayList<>(),frameIds=new ArrayList<>();
    private int nextFrame=1, sequence=0,maxEvents;
    private long ownerThread=-1;
    private String stdout="",stderr="";
    private Map<String,Object> heap;
    private boolean terminal=false;
    private static final String[] EXCLUDED={"java.*","javax.*","jdk.*","sun.*","com.sun.*","CodeFlowTarget*"};
    private static Map<String,Object> map(Object... items) {
        Map<String,Object> out=new LinkedHashMap<>();
        for(int i=0;i<items.length;i+=2)out.put((String)items[i],items[i+1]);
        return out;
    }
    private boolean user(Location location) {return userClasses.contains(location.declaringType().name());}
    private Map<String,Object> location(Location l){return map("sourceId","main","line",Math.max(1,l.lineNumber()));}
    private String id(ObjectReference v){return objectIds.computeIfAbsent(v.uniqueID(),k->"r"+(objectIds.size()+1));}
    private Object value(Value v,int depth) {
        if(v==null)return map("kind","primitive","type","null","value",null);
        String type=v.type().name();
        if(v instanceof StringReference s)return map("kind","primitive","type",type,"value",s.value().length()>2048?s.value().substring(0,2048)+"…":s.value());
        if(v instanceof BooleanValue b)return map("kind","primitive","type",type,"value",b.value());
        if(v instanceof CharValue c)return map("kind","primitive","type",type,"value",String.valueOf(c.value()));
        if(v instanceof LongValue n)return map("kind","primitive","type",type,"value",String.valueOf(n.value()));
        if(v instanceof PrimitiveValue p) {
            Object n;
            if(v instanceof FloatValue || v instanceof DoubleValue) {
                double d=p.doubleValue();n=Double.isFinite(d)?d:String.valueOf(d);
            } else n=p.intValue();
            return map("kind","primitive","type",type,"value",n);
        }
        if(v instanceof VoidValue)return map("kind","primitive","type","void","value",null);
        if(v instanceof ObjectReference obj) {
            String ref=id(obj);
            if(!heap.containsKey(ref)&&heap.size()<128) {
                Map<String,Object> node=map("id",ref,"type",type,"kind",obj instanceof ArrayReference?"array":"object");
                heap.put(ref,node);
                if(depth>=3){node.put("truncated",true);}
                else if(obj instanceof ArrayReference a) {
                    List<Object> values=new ArrayList<>();
                    for(Value item:a.getValues(0,Math.min(64,a.length())))values.add(value(item,depth+1));
                    node.put("elements",values);node.put("length",a.length());node.put("truncated",a.length()>64);
                } else {
                    Map<String,Object> fields=new LinkedHashMap<>();
                    List<Field> visible=obj.referenceType().allFields().stream().filter(f->!f.isStatic()&&!f.isSynthetic()).sorted(Comparator.comparing(Field::name)).limit(64).toList();
                    for(Field f:visible)fields.put(f.declaringType().name()+"."+f.name(),value(obj.getValue(f),depth+1));
                    node.put("fields",fields);node.put("truncated",visible.size()>=64);
                }
            }
            return map("kind","reference","type",type,"ref",ref);
        }
        return map("kind","unavailable","type",type,"reason","Value not exposed by JDI");
    }
    private void captureOutput() {
        List<ReferenceType> targets=vm.classesByName("CodeFlowTarget");
        if(targets.isEmpty())return;
        ReferenceType target=targets.get(0);
        Value out=target.getValue(target.fieldByName("stdout")),err=target.getValue(target.fieldByName("stderr"));
        stdout=out instanceof StringReference s?s.value():"";
        stderr=err instanceof StringReference s?s.value():"";
    }
    private List<Object> frames(ThreadReference thread) throws IncompatibleThreadStateException {
        List<StackFrame> sourceFrames=thread.frames().stream().filter(f->user(f.location())).limit(128).toList();
        List<String> keys=sourceFrames.stream().map(f->f.location().declaringType().name()+"."+f.location().method().name()+f.location().method().signature()).toList();
        int common=0;
        while(common<keys.size() && common<frameKeys.size() && keys.get(keys.size()-1-common).equals(frameKeys.get(frameKeys.size()-1-common)))common++;
        List<String> newIds=new ArrayList<>();
        for(int i=0;i<keys.size()-common;i++)newIds.add("f"+nextFrame++);
        newIds.addAll(frameIds.subList(frameIds.size()-common,frameIds.size()));
        frameKeys.clear();frameKeys.addAll(keys);frameIds.clear();frameIds.addAll(newIds);
        List<Object> out=new ArrayList<>();
        for(int i=0;i<sourceFrames.size();i++) {
            StackFrame f=sourceFrames.get(i);
            Map<String,Object> locals=new LinkedHashMap<>();
            try {
                for(LocalVariable var:f.visibleVariables().stream().sorted(Comparator.comparing(LocalVariable::name)).limit(128).toList())locals.put(var.name(),value(f.getValue(var),0));
                if(f.thisObject()!=null)locals.put("this",value(f.thisObject(),0));
            } catch(AbsentInformationException ex) {locals.put("<debug info>",map("kind","unavailable","type","unknown","reason","Compile with -g"));}
            out.add(map("id",newIds.get(i),"name",f.location().declaringType().name()+"."+f.location().method().name(),"location",location(f.location()),"locals",locals));
        }
        return out;
    }
    private void emit(String type,ThreadReference thread,Location loc,Map<String,Object> detail,Value returnValue) throws Exception {
        heap=new LinkedHashMap<>();
        captureOutput();
        List<Object> stack=thread==null?List.of():frames(thread);
        if(returnValue!=null)detail.put("value",value(returnValue,0));
        Map<String,Object> event=map("id","e"+sequence,"sequence",sequence++,"type",type,"provenance","observed","frames",stack,"heap",heap,"output",map("stdout",stdout,"stderr",stderr),"detail",detail);
        if(loc!=null)event.put("location",location(loc));
        System.out.println(json(event));System.out.flush();
    }
    private static String json(Object v) {
        if(v==null)return "null";
        if(v instanceof String s) {
            StringBuilder b=new StringBuilder("\"");
            for(char c:s.toCharArray()) {
                if(c=='"')b.append("\\\"");else if(c=='\\')b.append("\\\\");else if(c<32 || c>126)b.append(String.format("\\u%04x",(int)c));else b.append(c);
            }
            return b.append('"').toString();
        }
        if(v instanceof Number || v instanceof Boolean)return v.toString();
        if(v instanceof Map<?,?> m){List<String> parts=new ArrayList<>();for(var e:m.entrySet())parts.add(json(e.getKey().toString())+":"+json(e.getValue()));return "{"+String.join(",",parts)+"}";}
        if(v instanceof Collection<?> items)return "["+String.join(",",items.stream().map(CodeFlowTracer::json).toList())+"]";
        throw new IllegalArgumentException("Non-JSON value");
    }
    private void step(ThreadReference thread) {
        StepRequest request=vm.eventRequestManager().createStepRequest(thread,StepRequest.STEP_LINE,StepRequest.STEP_INTO);
        for(String prefix:EXCLUDED)request.addClassExclusionFilter(prefix);
        request.setSuspendPolicy(EventRequest.SUSPEND_ALL);request.enable();
    }
    private void run(String[] args) throws Exception {
        Path classes=Path.of(args[0]);String entry=args[1];maxEvents=Integer.parseInt(args[4]);long timeout=Long.parseLong(args[5]);
        try(var paths=Files.walk(classes)){paths.filter(p->p.toString().endsWith(".class")).forEach(p->userClasses.add(classes.relativize(p).toString().replace(File.separatorChar,'.').replaceAll("\\.class$","")));}
        LaunchingConnector connector=Bootstrap.virtualMachineManager().defaultConnector();
        Map<String,Connector.Argument> options=connector.defaultArguments();
        String cp=classes.toAbsolutePath()+File.pathSeparator+Path.of(CodeFlowTracer.class.getProtectionDomain().getCodeSource().getLocation().toURI());
        options.get("options").setValue("--enable-preview -Xmx64m -Xss512k -Dfile.encoding=UTF-8 -cp \""+cp+"\"");
        options.get("main").setValue("CodeFlowTarget "+entry+" \""+args[2]+"\" \""+args[3]+"\"");
        options.get("suspend").setValue("true");
        vm=connector.launch(options);
        Process child=vm.process();
        Thread outReader=new Thread(()->{try{child.getInputStream().transferTo(OutputStream.nullOutputStream());}catch(IOException ignored){}});
        Thread errReader=new Thread(()->{try{child.getErrorStream().transferTo(OutputStream.nullOutputStream());}catch(IOException ignored){}});
        outReader.setDaemon(true);errReader.setDaemon(true);outReader.start();errReader.start();
        EventRequestManager manager=vm.eventRequestManager();
        MethodEntryRequest calls=manager.createMethodEntryRequest();
        for(String prefix:EXCLUDED)calls.addClassExclusionFilter(prefix);
        calls.setSuspendPolicy(EventRequest.SUSPEND_ALL);calls.enable();
        MethodExitRequest exits=manager.createMethodExitRequest();
        for(String prefix:EXCLUDED)exits.addClassExclusionFilter(prefix);
        exits.setSuspendPolicy(EventRequest.SUSPEND_ALL);exits.enable();
        MethodEntryRequest finished=manager.createMethodEntryRequest();finished.addClassFilter("CodeFlowTarget");finished.setSuspendPolicy(EventRequest.SUSPEND_ALL);finished.enable();
        ExceptionRequest errors=manager.createExceptionRequest(null,true,true);errors.setSuspendPolicy(EventRequest.SUSPEND_ALL);errors.enable();
        long deadline=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(timeout);
        try {
            while(!terminal) {
                if(System.nanoTime()>deadline){emit("limit",null,null,map("reason","Wall clock limit"),null);terminal=true;break;}
                EventSet set=vm.eventQueue().remove(100);
                if(set==null)continue;
                for(Event event:set) {
                    if(event instanceof VMDeathEvent || event instanceof VMDisconnectEvent){emitDisconnected();terminal=true;break;}
                    if(event instanceof MethodEntryEvent e && e.method().declaringType().name().equals("CodeFlowTarget")) {
                        if(e.method().name().equals("finish")) {
                            ReferenceType target=e.method().declaringType();captureOutput();
                            Value failure=target.getValue(target.fieldByName("failureType"));
                            String failureType=failure instanceof StringReference s?s.value():"";
                            boolean limited=((BooleanValue)target.getValue(target.fieldByName("outputLimited"))).value();
                            emit(limited?"limit":"terminated",null,null,map("status",limited?"limited":failureType.isEmpty()?"completed":"exception","exceptionType",failureType),null);
                            terminal=true;break;
                        }
                        continue;
                    }
                    if(event instanceof LocatableEvent e && user(e.location())) {
                        if(ownerThread==-1){ownerThread=e.thread().uniqueID();step(e.thread());}
                        if(e.thread().uniqueID()!=ownerThread){emit("limit",null,null,map("reason","Multiple user threads are not supported"),null);terminal=true;break;}
                        if(sequence>=maxEvents){emit("limit",null,null,map("reason","Event budget exceeded"),null);terminal=true;break;}
                        if(event instanceof MethodEntryEvent)emit("call",e.thread(),e.location(),map("name",e.location().method().name()),null);
                        else if(event instanceof MethodExitEvent exit) {
                            emit("return",e.thread(),e.location(),map("name",e.location().method().name()),vm.canGetMethodReturnValues()?exit.returnValue():null);
                            if(!frameIds.isEmpty()){frameIds.remove(0);frameKeys.remove(0);}
                        } else if(event instanceof StepEvent)emit("line",e.thread(),e.location(),map(),null);
                        else if(event instanceof ExceptionEvent error)emit("exception",e.thread(),e.location(),map("type",error.exception().referenceType().name(),"caught",error.catchLocation()!=null),null);
                    } else if(event instanceof ExceptionEvent e) {
                        boolean userStack=e.thread().frames().stream().anyMatch(f->user(f.location()));
                        if(userStack && (e.catchLocation()==null || user(e.catchLocation()))) {
                            Location loc=e.thread().frames().stream().filter(f->user(f.location())).findFirst().orElseThrow().location();
                            emit("exception",e.thread(),loc,map("type",e.exception().referenceType().name(),"caught",e.catchLocation()!=null),null);
                        }
                    }
                }
                if(!terminal)set.resume();
            }
        } catch(VMDisconnectedException ex) {
            if(!terminal) {emitDisconnected();terminal=true;}
        } finally {
            try{vm.exit(0);}catch(VMDisconnectedException ignored){}
            child.descendants().forEach(ProcessHandle::destroyForcibly);child.destroyForcibly();
        }
    }
    private void emitDisconnected() {
        Map<String,Object> e=map("id","e"+sequence,"sequence",sequence++,"type","terminated","provenance","observed","frames",List.of(),"heap",Map.of(),"output",map("stdout",stdout,"stderr",stderr),"detail",map("status","exception","reason","VM exited without normal completion"));
        System.out.println(json(e));
    }
    public static void main(String[] args) throws Exception {new CodeFlowTracer().run(args);}
}
