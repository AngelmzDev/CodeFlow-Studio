import com.sun.source.tree.*;
import com.sun.source.util.JavacTask;
import com.sun.source.util.TreeScanner;
import com.sun.source.util.Trees;
import javax.tools.*;
import java.io.File;
import java.util.*;

/** Parses a Java source file and emits static activity diagrams. Target code is never analyzed or generated. */
public final class CodeFlowAnalyze {
  static final int MAX_DIAGRAMS=24, MAX_NODES=200, MAX_EDGES=600, MAX_CLASSES=24;
  final String source, fileName;
  final CompilationUnitTree unit;
  final Trees trees;
  final ArrayList<String> diagnostics=new ArrayList<>();
  final ArrayList<Map<String,Object>> classes=new ArrayList<>(), diagrams=new ArrayList<>();
  CodeFlowAnalyze(String source,String fileName,CompilationUnitTree unit,Trees trees){this.source=source;this.fileName=fileName;this.unit=unit;this.trees=trees;}
  static Map<String,Object> map(Object... xs){Map<String,Object> m=new LinkedHashMap<>();for(int i=0;i<xs.length;i+=2)m.put((String)xs[i],xs[i+1]);return m;}
  int line(Tree t){long p=trees.getSourcePositions().getStartPosition(unit,t);return p<0?1:(int)unit.getLineMap().getLineNumber(p);}
  int endLine(Tree t){long p=trees.getSourcePositions().getEndPosition(unit,t);return p<0?line(t):(int)unit.getLineMap().getLineNumber(Math.max(0,p-1));}
  String text(Tree t,int limit){long a=trees.getSourcePositions().getStartPosition(unit,t),b=trees.getSourcePositions().getEndPosition(unit,t);String s=(a<0||b<a||b>source.length())?t.toString():source.substring((int)a,(int)b);s=s.replaceAll("\\s+"," ").trim();return s.length()<=limit?s:s.substring(0,limit-1)+"…";}
  String methodSignature(MethodTree m){long a=trees.getSourcePositions().getStartPosition(unit,m),b=m.getBody()==null?-1:trees.getSourcePositions().getStartPosition(unit,m.getBody());String s=(a>=0&&b>=a&&b<=source.length())?source.substring((int)a,(int)b):m.getModifiers()+" "+(m.getReturnType()==null?"":m.getReturnType()+" ")+m.getName()+"("+String.join(", ",m.getParameters().stream().map(Object::toString).toList())+")";s=s.replaceAll("\\s+"," ").trim();return s.length()<=160?s:s.substring(0,159)+"…";}
  String valueLabel(ExpressionTree value){
    if(value instanceof LiteralTree literal){Object v=literal.getValue();if(v instanceof String str)return str.isEmpty()?"vacío":"«"+(str.length()>55?str.substring(0,54)+"…":str.replaceAll("\\s+"," "))+"»";return String.valueOf(v);}
    if(value instanceof MethodInvocationTree call){String method=text(call.getMethodSelect(),70);if(method.endsWith(".nextInt()")||method.endsWith(".nextInt"))return "el número introducido";if(method.endsWith(".nextLine()")||method.endsWith(".nextLine"))return "el texto introducido";}
    return text(value,65);
  }
  String conditionLabel(ExpressionTree condition){
    if(condition instanceof ParenthesizedTree p)return conditionLabel(p.getExpression());
    if(condition instanceof BinaryTree pair&&pair.getKind()==Tree.Kind.CONDITIONAL_OR&&pair.getLeftOperand() instanceof BinaryTree low&&pair.getRightOperand() instanceof BinaryTree high&&low.getKind()==Tree.Kind.LESS_THAN&&high.getKind()==Tree.Kind.GREATER_THAN_EQUAL&&text(low.getLeftOperand(),80).equals(text(high.getLeftOperand(),80))&&low.getRightOperand() instanceof LiteralTree a&&high.getRightOperand() instanceof LiteralTree b&&a.getValue() instanceof Number lower&&b.getValue() instanceof Number upper&&lower.intValue()==1){return "¿"+text(low.getLeftOperand(),45)+" está fuera de 1 a "+(upper.intValue()-1)+"?";}
    return "¿"+text(condition,76)+"?";
  }
  String actionLabel(StatementTree statement){
    if(statement instanceof VariableTree v){String name=v.getName().toString();return v.getInitializer()==null?"Preparar "+name:"Guardar "+valueLabel(v.getInitializer())+" en "+name;}
    if(statement instanceof ExpressionStatementTree e){ExpressionTree x=e.getExpression();if(x instanceof AssignmentTree a)return "Guardar "+valueLabel(a.getExpression())+" en "+text(a.getVariable(),45);if(x instanceof CompoundAssignmentTree a)return "Actualizar "+text(a.getVariable(),45)+" con "+valueLabel(a.getExpression());if(x instanceof MethodInvocationTree call&&text(call.getMethodSelect(),90).matches("(?:System\\.out|System\\.err)\\.(?:print|println|printf)")){if(call.getArguments().size()==1&&call.getArguments().get(0) instanceof LiteralTree)return "Mostrar "+valueLabel(call.getArguments().get(0));return "Mostrar información en pantalla";}}
    return text(statement,85);
  }
  Map<String,Object> node(String id,String kind,String label,int line,int end){Map<String,Object> n=map("id",id,"kind",kind,"label",label.substring(0,Math.min(160,label.length())),"line",line);if(end!=line)n.put("endLine",end);return n;}

  final class Graph {
    String id,label; int startLine,endLine,seq=0; ArrayList<Map<String,Object>> nodes=new ArrayList<>(),edges=new ArrayList<>();ArrayList<String>warnings=new ArrayList<>();ArrayDeque<Loop> loops=new ArrayDeque<>();String start,end;
    class Loop{String test,after;ArrayList<String> breaks=new ArrayList<>(),continues=new ArrayList<>();Loop(String t,String a){test=t;after=a;}}
    Graph(String id,String label,BlockTree body,Tree owner){this.id=id;this.label=label;startLine=line(owner);endLine=endLine(owner);start=add("start","Start",startLine,startLine);end=add("end","End",endLine,endLine);List<String> tails=block(body.getStatements(),List.of(start));connect(tails,end,null);}
    String add(String kind,String label,int ln,int endln){if(nodes.size()>=MAX_NODES){warn("Node limit reached; remaining statements were omitted.");return null;}String n="n"+(++seq);nodes.add(node(n,kind,label,ln,endln));return n;}
    void warn(String s){if(!warnings.contains(s))warnings.add(s);}
    void edge(String a,String b,String label){if(a==null||b==null)return;if(edges.size()>=MAX_EDGES){warn("Edge limit reached; remaining control flow was omitted.");return;}Map<String,Object> e=map("id","e"+(edges.size()+1),"from",a,"to",b);if(label!=null&&!label.isEmpty())e.put("label",label);edges.add(e);}
    void connect(List<String> from,String to,String label){for(String x:from)edge(x,to,label);}
    List<String> block(List<? extends StatementTree> ss,List<String> in){List<String> tails=in;for(StatementTree s:ss){if(tails.isEmpty())break;if(nodes.size()>=MAX_NODES){warn("Node limit reached; remaining statements were omitted.");break;}tails=stmt(s,tails);}return tails;}
    List<String> opaque(StatementTree s,List<String> in,String kind){warn("Unsupported "+kind+" is shown as an opaque static step; internal flow is not modeled.");String n=add("note",text(s,160),line(s),endLine(s));connect(in,n,null);return n==null?List.of():List.of(n);}
    List<String> ternary(StatementTree statement,List<String> in){
      ConditionalExpressionTree choice=null;String name=null;
      if(statement instanceof VariableTree v&&v.getInitializer() instanceof ConditionalExpressionTree c){choice=c;name=v.getName().toString();}
      if(statement instanceof ExpressionStatementTree e&&e.getExpression() instanceof AssignmentTree a&&a.getExpression() instanceof ConditionalExpressionTree c){choice=c;name=text(a.getVariable(),45);}
      if(choice==null)return null;
      String decision=add("decision",conditionLabel(choice.getCondition()),line(statement),line(statement));connect(in,decision,null);
      String yes=add("action","Guardar "+valueLabel(choice.getTrueExpression())+" en "+name,line(statement),endLine(statement));
      String no=add("action","Guardar "+valueLabel(choice.getFalseExpression())+" en "+name,line(statement),endLine(statement));
      String merge=add("merge","Continuar",endLine(statement),endLine(statement));
      edge(decision,yes,"true");edge(decision,no,"false");edge(yes,merge,null);edge(no,merge,null);
      return one(merge);
    }
    List<String> switchFlow(SwitchTree choice,StatementTree statement,List<String> in){
      if(choice.getCases().stream().anyMatch(c->c.getCaseKind()!=CaseTree.CaseKind.RULE))return opaque(statement,in,"colon-style switch with possible fall-through");
      ExpressionTree selector=choice.getExpression() instanceof ParenthesizedTree p?p.getExpression():choice.getExpression();
      String decision=add("decision","Elegir según "+text(selector,55),line(statement),line(statement));
      String merge=add("merge","Continuar tras la elección",endLine(statement),endLine(statement));connect(in,decision,null);
      boolean hasDefault=false;
      for(CaseTree branch:choice.getCases()){
        String label=branch.getExpressions().isEmpty()?"otro":"caso "+String.join(", ",branch.getExpressions().stream().map(x->text(x,28)).toList());
        if(branch.getExpressions().isEmpty())hasDefault=true;
        Tree body=branch.getBody();
        List<? extends StatementTree> statements=body instanceof BlockTree block?block.getStatements():body instanceof StatementTree single?List.of(single):List.of();
        if(statements.isEmpty()){edge(decision,merge,label);continue;}
        List<String> tails=guarded(statements,decision,label);connect(tails,merge,null);
      }
      if(!hasDefault)edge(decision,merge,"otro");
      return one(merge);
    }
    List<String> stmt(StatementTree s,List<String> in){
      List<String> conditional=ternary(s,in);if(conditional!=null)return conditional;
      switch(s.getKind()){
        case IF -> {IfTree x=(IfTree)s;String d=add("decision",conditionLabel(x.getCondition()),line(s),line(s));connect(in,d,null);List<? extends StatementTree> ts=asList(x.getThenStatement());List<String>a=guarded(ts,d,"true");List<? extends StatementTree> es=x.getElseStatement()==null?List.of():asList(x.getElseStatement());List<String>b=x.getElseStatement()==null?List.of():guarded(es,d,"false");boolean emptyThen=ts.isEmpty(),emptyElse=x.getElseStatement()==null||es.isEmpty();if(a.isEmpty()&&b.isEmpty()&&!emptyThen&&!emptyElse)return List.of();String m=add("merge","Merge",endLine(s),endLine(s));connect(a,m,null);connect(b,m,null);if(emptyThen)edge(d,m,"true");if(emptyElse)edge(d,m,"false");return m==null?List.of():List.of(m);}
        case FOR_LOOP -> {ForLoopTree x=(ForLoopTree)s;List<String> cursor=in;for(StatementTree init:x.getInitializer()){String ni=add("action",text(init,160),line(init),endLine(init));connect(cursor,ni,null);cursor=ni==null?List.of():List.of(ni);}String d=add("decision",x.getCondition()==null?"true":text(x.getCondition(),160),line(s),line(s)),after=add("merge","Loop exit",endLine(s),endLine(s));connect(cursor,d,null);ArrayList<String> updates=new ArrayList<>();for(ExpressionStatementTree update:x.getUpdate()){String un=add("action",text(update,160),line(update),endLine(update));if(un!=null)updates.add(un);}String updateEntry=updates.isEmpty()?d:updates.get(0);for(int i=0;i+1<updates.size();i++)edge(updates.get(i),updates.get(i+1),null);if(!updates.isEmpty())edge(updates.get(updates.size()-1),d,"repeat");Loop c=new Loop(d,after);loops.push(c);List<String> bt=guarded(asList(x.getStatement()),d,"true");loops.pop();connect(bt,updateEntry,updates.isEmpty()?"repeat":null);connect(c.continues,updateEntry,null);connect(c.breaks,after,null);if(x.getCondition()!=null)edge(d,after,"false");if(x.getCondition()==null&&c.breaks.isEmpty()){nodes.removeIf(n->n.get("id").equals(after));return List.of();}return one(after);}
        case WHILE_LOOP, ENHANCED_FOR_LOOP -> {String label=loopLabel(s);String d=add("decision",label,line(s),line(s)),after=add("merge","Loop exit",endLine(s),endLine(s));connect(in,d,null);Loop c=new Loop(d,after);loops.push(c);StatementTree body=s instanceof WhileLoopTree x?x.getStatement():((EnhancedForLoopTree)s).getStatement();List<String> bt=guarded(asList(body),d,"true");loops.pop();connect(bt,d,"repeat");connect(c.continues,d,"repeat");connect(c.breaks,after,null);edge(d,after,"false");return one(after);}
        case DO_WHILE_LOOP -> {DoWhileLoopTree x=(DoWhileLoopTree)s;String entry=add("action","do",line(s),line(s)),d=add("decision",text(x.getCondition(),160),endLine(s),endLine(s)),after=add("merge","Loop exit",endLine(s),endLine(s));connect(in,entry,null);Loop c=new Loop(d,after);loops.push(c);List<String> bt=block(asList(x.getStatement()),one(entry));loops.pop();connect(bt,d,null);connect(c.continues,d,null);connect(c.breaks,after,null);edge(d,entry,"true");edge(d,after,"false");return one(after);}
        case BREAK -> {if(((BreakTree)s).getLabel()!=null){List<String> ns=opaque(s,in,"labeled break");if(!ns.isEmpty())edge(ns.get(0),end,null);return List.of();}String n=add("action",text(s,160),line(s),endLine(s));connect(in,n,null);if(!loops.isEmpty())loops.peek().breaks.add(n);else warn("break outside modeled loop encountered; treated as terminal.");return List.of();}
        case CONTINUE -> {if(((ContinueTree)s).getLabel()!=null){List<String> ns=opaque(s,in,"labeled continue");if(!ns.isEmpty())edge(ns.get(0),end,null);return List.of();}String n=add("action",text(s,160),line(s),endLine(s));connect(in,n,null);if(!loops.isEmpty())loops.peek().continues.add(n);else warn("continue outside modeled loop encountered; treated as terminal.");return List.of();}
        case RETURN -> {String n=add("return",text(s,160),line(s),endLine(s));connect(in,n,null);edge(n,end,null);return List.of();}
        case THROW -> {String n=add("action",text(s,160),line(s),endLine(s));connect(in,n,null);edge(n,end,null);return List.of();}
        case SWITCH -> {return switchFlow((SwitchTree)s,s,in);}
        case SWITCH_EXPRESSION -> {return opaque(s,in,"switch expression");}
        case TRY -> {return opaque(s,in,"try/finally");}
        case LABELED_STATEMENT -> {return opaque(s,in,"labeled statement");}
        case SYNCHRONIZED -> {return opaque(s,in,"synchronized block");}
        case BLOCK -> {return block(((BlockTree)s).getStatements(),in);}
        case EMPTY_STATEMENT -> {return in;}
        default -> {String n=add(s.getKind()==Tree.Kind.EXPRESSION_STATEMENT&&((ExpressionStatementTree)s).getExpression() instanceof MethodInvocationTree?"call":"action",actionLabel(s),line(s),endLine(s));connect(in,n,null);return n==null?List.of():List.of(n);}
      }
    }
    String loopLabel(StatementTree s){if(s instanceof WhileLoopTree x)return text(x.getCondition(),130);if(s instanceof ForLoopTree x){String init=String.join(",",x.getInitializer().stream().map(t->text(t,50)).toList()),cond=x.getCondition()==null?"true":text(x.getCondition(),70),up=String.join(",",x.getUpdate().stream().map(t->text(t,40)).toList());return "for ("+init+"; "+cond+"; "+up+")";}EnhancedForLoopTree x=(EnhancedForLoopTree)s;return "for ("+text(x.getVariable(),50)+" : "+text(x.getExpression(),80)+")";}
    List<? extends StatementTree> asList(StatementTree s){return s instanceof BlockTree b?b.getStatements():List.of(s);}
    List<String> one(String node){return node==null?List.of():List.of(node);}
    List<String> guarded(List<? extends StatementTree> statements,String decision,String guard){int before=edges.size();List<String> tails=block(statements,one(decision));if(edges.size()>before)edges.get(before).put("label",guard);return tails;}
    Map<String,Object> result(){return map("id",id,"label",label,"startLine",startLine,"endLine",endLine,"nodes",nodes,"edges",edges,"warnings",warnings);}
  }
  void collect(){
    new TreeScanner<Void,String>(){
      final ArrayDeque<String> owners=new ArrayDeque<>();
      @Override public Void visitClass(ClassTree c,String parent){String name=(parent==null?"":parent+".")+c.getSimpleName();String pkg=unit.getPackageName()==null?"":unit.getPackageName().toString()+".";List<String> fields=new ArrayList<>(),methods=new ArrayList<>(),ext=new ArrayList<>(),impl=new ArrayList<>();for(Tree m:c.getMembers()){if(m instanceof VariableTree v)fields.add(text(v,160));if(m instanceof MethodTree mt)methods.add(methodSignature(mt));}if(c.getExtendsClause()!=null)ext.add(text(c.getExtendsClause(),120));for(Tree t:c.getImplementsClause())(c.getKind()==Tree.Kind.INTERFACE?ext:impl).add(text(t,120));if(fields.size()>64){fields=new ArrayList<>(fields.subList(0,64));if(!diagnostics.contains("Class field limit reached; some declarations were omitted."))diagnostics.add("Class field limit reached; some declarations were omitted.");}if(methods.size()>64){methods=new ArrayList<>(methods.subList(0,64));if(!diagnostics.contains("Class method limit reached; some declarations were omitted."))diagnostics.add("Class method limit reached; some declarations were omitted.");}if(classes.size()<MAX_CLASSES){String kind=c.getKind()==Tree.Kind.INTERFACE?"interface":c.getKind()==Tree.Kind.ENUM?"enum":"class";classes.add(map("id","class-"+(classes.size()+1),"name",pkg+name,"kind",kind,"line",line(c),"fields",fields,"methods",methods,"extends",ext,"implements",impl));}else if(!diagnostics.contains("Class limit reached; additional declarations were omitted."))diagnostics.add("Class limit reached; additional declarations were omitted.");owners.push(pkg+name);super.visitClass(c,name);owners.pop();return null;}
      @Override public Void visitMethod(MethodTree m,String unused){if(m.getBody()!=null){String owner=owners.isEmpty()?"":owners.peek();String sig=m.getName()+"("+String.join(",",m.getParameters().stream().map(p->p.getType().toString()).toList())+")";String id=(owner.isEmpty()?"":owner+".")+sig;if(diagrams.size()<MAX_DIAGRAMS)diagrams.add(new Graph(id,sig,m.getBody(),m).result());else if(!diagnostics.contains("Diagram limit reached; additional methods were omitted."))diagnostics.add("Diagram limit reached; additional methods were omitted.");}return null;}
    }.scan(unit,null);
  }
  String primary(){String pkg=unit.getPackageName()==null?"":unit.getPackageName().toString()+".";for(Tree t:unit.getTypeDecls())if(t instanceof ClassTree c)for(Tree m:c.getMembers())if(m instanceof MethodTree mt&&mt.getName().contentEquals("main")&&mt.getModifiers().getFlags().contains(javax.lang.model.element.Modifier.STATIC)&&mt.getParameters().size()==1)return pkg+c.getSimpleName();return null;}
  Map<String,Object> result(){collect();String def="";String entry=primary();if(entry!=null){for(Map<String,Object>d:diagrams)if(((String)d.get("id")).startsWith(entry+".main(")){def=(String)d.get("id");break;}}if(def.isEmpty()&&!diagrams.isEmpty())def=(String)diagrams.get(0).get("id");Map<String,Object> out=map("schemaVersion","1.0","language","java","provenance","static","source",map("name",fileName,"content",source),"defaultDiagramId",def,"diagrams",diagrams,"classes",classes,"diagnostics",diagnostics);if(entry!=null)out.put("primaryEntry",entry);return out;}
  public static void main(String[] args){System.setOut(new java.io.PrintStream(new java.io.FileOutputStream(java.io.FileDescriptor.out),true,java.nio.charset.StandardCharsets.UTF_8));if(args.length!=1){System.err.println("Usage: CodeFlowAnalyze SOURCE_FILE");System.exit(2);}try{File f=new File(args[0]);String source=java.nio.file.Files.readString(f.toPath());JavaCompiler compiler=ToolProvider.getSystemJavaCompiler();if(compiler==null)throw new IllegalStateException("A JDK compiler is required.");DiagnosticCollector<JavaFileObject> dc=new DiagnosticCollector<>();StandardJavaFileManager fm=compiler.getStandardFileManager(dc,null,null);Iterable<? extends JavaFileObject> files=fm.getJavaFileObjects(f);JavacTask task=(JavacTask)compiler.getTask(null,fm,dc,List.of("-proc:none"),null,files);Iterator<? extends CompilationUnitTree> it=task.parse().iterator();if(!it.hasNext())throw new IllegalArgumentException("No Java compilation unit found.");CompilationUnitTree unit=it.next();String error=null;for(Diagnostic<?> d:dc.getDiagnostics())if(d.getKind()==Diagnostic.Kind.ERROR){error="Java syntax error at line "+d.getLineNumber()+": "+d.getMessage(Locale.ROOT);break;}Map<String,Object> result;if(error!=null)result=map("schemaVersion","1.0","language","java","provenance","static","source",map("name",f.getName(),"content",source),"defaultDiagramId","","diagrams",List.of(),"classes",List.of(),"diagnostics",List.of(error));else result=new CodeFlowAnalyze(source,f.getName(),unit,Trees.instance(task)).result();System.out.println(json(result));fm.close();}catch(Throwable e){System.out.println("{\"error\":"+quote(e.toString())+"}");System.exit(1);}}
  static String json(Object x){if(x==null)return "null";if(x instanceof String)return quote((String)x);if(x instanceof Number||x instanceof Boolean)return x.toString();if(x instanceof Map<?,?> m){StringJoiner j=new StringJoiner(",","{","}");for(var e:m.entrySet())j.add(quote(e.getKey().toString())+":"+json(e.getValue()));return j.toString();}if(x instanceof Iterable<?> a){StringJoiner j=new StringJoiner(",","[","]");for(Object v:a)j.add(json(v));return j.toString();}return quote(x.toString());}
  static String quote(String x){StringBuilder b=new StringBuilder("\"");for(int i=0;i<x.length();i++){char c=x.charAt(i);switch(c){case '\\'->b.append("\\\\");case '"'->b.append("\\\"");case '\n'->b.append("\\n");case '\r'->b.append("\\r");case '\t'->b.append("\\t");case '\b'->b.append("\\b");case '\f'->b.append("\\f");default->{if(c<32)b.append(String.format(Locale.ROOT,"\\u%04x",(int)c));else b.append(c);}}}return b.append('"').toString();}
}
