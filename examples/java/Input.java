import java.util.Scanner;

public class Input {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        int count = scanner.nextInt();
        int total = 0;
        for (int value = 1; value <= count; value++) {
            total += value;
        }
        System.out.println(total);
        scanner.close();
    }
}

// With stdin "5", expected output: 15
